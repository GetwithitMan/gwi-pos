import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import { getLocationTaxRate, calculateSplitTax } from '@/lib/order-calculations'
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api-errors'
import { validateRequest } from '@/lib/validations'
import { z } from 'zod'
import { calculateSplitTicketPricing, type OrderItemInput, type RoundingIncrement } from '@/lib/split-pricing'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitToLocation } from '@/lib/socket-server'
import { dispatchFloorPlanUpdate, dispatchSplitCreated } from '@/lib/socket-dispatch'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { created, err, ok } from '@/lib/api-response'

const log = createChildLogger('orders-split-tickets')

// ============================================
// Validation Schemas
// ============================================

const splitAssignmentSchema = z.object({
  ticketIndex: z.number().int().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
})

const splitItemFractionSchema = z.object({
  ticketIndex: z.number().int().min(1),
  fraction: z.number().gt(0).lte(1),
})

const splitItemSchema = z.object({
  originalItemId: z.string().min(1),
  fractions: z.array(splitItemFractionSchema).min(2, 'At least 2 fractions required'),
})

const createSplitTicketsSchema = z.object({
  assignments: z.array(splitAssignmentSchema).min(2, 'At least 2 tickets required'),
  splitItems: z.array(splitItemSchema).optional().default([]),
})

// ============================================
// GET - Get all split tickets for an order
// ============================================

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const orderCheck = await db.order.findFirst({
        where: { id },
        select: { id: true, locationId: true },
      })
      if (!orderCheck) {
        throw new NotFoundError('Order')
      }
      locationId = orderCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(id, locationId, {
      splitOrders: {
        where: { deletedAt: null },
        include: {
          items: {
            select: {
              id: true,
              name: true,
              price: true,
              quantity: true,
              itemTotal: true,
              status: true,
              seatNumber: true,
              isCompleted: true,
              specialNotes: true,
              modifiers: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  preModifier: true,
                  depth: true,
                  quantity: true,
                  isCustomEntry: true,
                  isNoneSelection: true,
                  customEntryName: true,
                  customEntryPrice: true,
                  swapTargetName: true,
                  swapPricingMode: true,
                  swapEffectivePrice: true,
                  linkedMenuItemId: true,
                  linkedMenuItemName: true,
                  spiritTier: true,
                },
              },
            },
          },
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          cards: {
            where: { status: 'authorized', deletedAt: null },
            select: { cardLast4: true, cardType: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          payments: {
            where: { status: 'completed' },
            select: { totalAmount: true },
          },
        },
        orderBy: { splitIndex: 'asc' },
      },
    })

    if (!order) {
      throw new NotFoundError('Order')
    }

    return ok({
      parentOrderId: order.id,
      splitOrders: order.splitOrders.map(split => ({
        id: split.id,
        splitIndex: split.splitIndex,
        displayNumber: split.displayNumber,
        status: split.status,
        subtotal: Number(split.subtotal),
        discountTotal: Number(split.discountTotal),
        taxTotal: Number(split.taxTotal),
        total: Number(split.total),
        itemCount: split.items.length,
        isPaid: split.status === 'paid',
        paidAmount: split.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0),
        employee: split.employee ? {
          id: split.employee.id,
          name: split.employee.displayName || `${split.employee.firstName} ${split.employee.lastName}`,
        } : null,
        card: split.cards[0] ? {
          last4: split.cards[0].cardLast4,
          brand: split.cards[0].cardType,
        } : null,
        items: split.items.map(item => ({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          itemTotal: Number(item.itemTotal),
          status: item.status,
          seatNumber: item.seatNumber,
          isSent: item.isCompleted,
          specialNotes: item.specialNotes,
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
            depth: mod.depth,
            quantity: mod.quantity,
            isCustomEntry: mod.isCustomEntry,
            isNoneSelection: mod.isNoneSelection,
            customEntryName: mod.customEntryName,
            customEntryPrice: mod.customEntryPrice ? Number(mod.customEntryPrice) : null,
            swapTargetName: mod.swapTargetName,
            swapPricingMode: mod.swapPricingMode,
            swapEffectivePrice: mod.swapEffectivePrice ? Number(mod.swapEffectivePrice) : null,
            linkedMenuItemName: mod.linkedMenuItemName,
            spiritTier: mod.spiritTier,
          })),
        })),
      })),
    })
  } catch (error) {
    return handleApiError(error, 'Failed to get split tickets')
  }
})

// ============================================
// POST - Create split tickets from an order
// ============================================

export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Validate request
    const validation = validateRequest(createSplitTicketsSchema, body)
    if (!validation.success) {
      throw new ValidationError(validation.error)
    }

    const { assignments, splitItems } = validation.data

    // Validate splitItems fractions sum to ~1.0
    for (const si of splitItems) {
      const fractionSum = si.fractions.reduce((sum, f) => sum + f.fraction, 0)
      if (Math.abs(fractionSum - 1.0) > 0.02) {
        throw new ValidationError(
          `Fractions for item ${si.originalItemId} sum to ${fractionSum}, must be approximately 1.0`
        )
      }
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let postLocationId = getRequestLocationId()
    if (!postLocationId) {
      const parentCheck = await db.order.findFirst({
        where: { id },
        select: { id: true, locationId: true },
      })
      if (!parentCheck) {
        throw new NotFoundError('Order')
      }
      postLocationId = parentCheck.locationId
    }

    // Permission check: POS_SPLIT_CHECKS required to create split tickets
    const actor = await getActorFromRequest(request)
    const splitEmployeeId = (body as any).employeeId || actor.employeeId
    const splitAuth = await requirePermission(splitEmployeeId, postLocationId, PERMISSIONS.POS_SPLIT_CHECKS)
    if (!splitAuth.authorized) return err(splitAuth.error, splitAuth.status)

    // Get the parent order with all items
    const parentOrder = await OrderRepository.getOrderByIdWithInclude(id, postLocationId, {
      location: true,
      items: {
        where: { deletedAt: null },
        include: { modifiers: true },
      },
    })

    if (!parentOrder) {
      throw new NotFoundError('Order')
    }

    if (!['open', 'sent', 'in_progress'].includes(parentOrder.status)) {
      throw new ValidationError('Cannot split a closed or already-split order')
    }

    // Prevent splitting a child split order (no nested splits)
    if (parentOrder.parentOrderId) {
      throw new ValidationError('Cannot split a child split order — only the original order can be split')
    }

    // Build set of split item IDs for quick lookup
    const splitItemIds = new Set(splitItems.map(si => si.originalItemId))

    // Validate that all non-split items are assigned, and split items are NOT in assignments
    const allItemIds = new Set(parentOrder.items.map(item => item.id))
    const assignedItemIds = new Set<string>()

    for (const assignment of assignments) {
      for (const itemId of assignment.itemIds) {
        if (splitItemIds.has(itemId)) {
          throw new ValidationError(
            `Item ${itemId} is in both splitItems and assignments. Split items are assigned via fractions.`
          )
        }
        if (!allItemIds.has(itemId)) {
          throw new ValidationError(`Item ${itemId} not found in order`)
        }
        if (assignedItemIds.has(itemId)) {
          throw new ValidationError(`Item ${itemId} assigned to multiple tickets`)
        }
        assignedItemIds.add(itemId)
      }
    }

    // Validate split item IDs exist in the order
    for (const si of splitItems) {
      if (!allItemIds.has(si.originalItemId)) {
        throw new ValidationError(`Split item ${si.originalItemId} not found in order`)
      }
      // Mark as accounted for
      assignedItemIds.add(si.originalItemId)
    }

    if (assignedItemIds.size !== allItemIds.size) {
      throw new ValidationError('All items must be assigned to a ticket (via assignments or splitItems)')
    }

    // Validate that splitItems fractions reference valid ticket indices
    const validTicketIndices = new Set(assignments.map(a => a.ticketIndex))
    for (const si of splitItems) {
      for (const f of si.fractions) {
        if (!validTicketIndices.has(f.ticketIndex)) {
          throw new ValidationError(
            `Split item ${si.originalItemId} references ticket ${f.ticketIndex} which doesn't exist in assignments`
          )
        }
      }
    }

    // Get settings for tax rate and rounding
    const settings = parentOrder.location.settings as {
      tax?: { defaultRate?: number; inclusiveTaxRate?: number }
      priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
    } | null
    // Prefer order-level exclusive tax rate snapshot; fall back to live rate
    const orderExclRate = (parentOrder as any).exclusiveTaxRate != null ? Number((parentOrder as any).exclusiveTaxRate) : undefined
    const taxRate = (orderExclRate != null && orderExclRate >= 0) ? orderExclRate : getLocationTaxRate(settings)
    // Prefer order-level snapshot; fall back to location setting with > 0 guard
    const orderInclRate = Number(parentOrder.inclusiveTaxRate) || undefined
    const inclRateRaw = settings?.tax?.inclusiveTaxRate
    const inclusiveRate = orderInclRate
      ?? (inclRateRaw != null && Number.isFinite(inclRateRaw) && inclRateRaw > 0
        ? inclRateRaw / 100 : undefined)
    const roundTo: RoundingIncrement = settings?.priceRounding?.enabled
      ? (settings.priceRounding.increment || '0.05')
      : 'none'

    // Create item lookup
    const itemMap = new Map(parentOrder.items.map(item => [item.id, item]))

    // Calculate original order totals
    const orderDiscount = Number(parentOrder.discountTotal)
    const orderSubtotal = Number(parentOrder.subtotal)

    // Sort assignments by ticket index
    const sortedAssignments = [...assignments].sort((a, b) => a.ticketIndex - b.ticketIndex)

    // Pre-compute fractional items per ticket
    // Map: ticketIndex -> array of { originalItem, fractionalPrice, labelIndex, totalFractions }
    type FractionalItemEntry = {
      originalItem: NonNullable<ReturnType<typeof itemMap.get>>
      fractionalPrice: number
      fraction: number
      labelIndex: number
      totalFractions: number
    }
    const fractionalItemsByTicket = new Map<number, FractionalItemEntry[]>()

    for (const si of splitItems) {
      const originalItem = itemMap.get(si.originalItemId)
      if (!originalItem) continue

      const originalPrice = Number(originalItem.price) * originalItem.quantity
      const modifiersTotal = originalItem.modifiers.reduce(
        (sum, m) => sum + Number(m.price) * (m.quantity || 1), 0
      )
      const totalItemPrice = originalPrice + modifiersTotal
      const N = si.fractions.length

      let allocatedSoFar = 0
      for (let i = 0; i < si.fractions.length; i++) {
        const f = si.fractions[i]
        let fractionalPrice: number

        if (i === si.fractions.length - 1) {
          // Last fraction gets remainder to ensure exact sum
          fractionalPrice = Math.round((totalItemPrice - allocatedSoFar) * 100) / 100
        } else {
          fractionalPrice = Math.floor(totalItemPrice * f.fraction * 100) / 100
        }
        allocatedSoFar += fractionalPrice

        if (!fractionalItemsByTicket.has(f.ticketIndex)) {
          fractionalItemsByTicket.set(f.ticketIndex, [])
        }
        fractionalItemsByTicket.get(f.ticketIndex)!.push({
          originalItem,
          fractionalPrice,
          fraction: f.fraction,
          labelIndex: i + 1,
          totalFractions: N,
        })
      }
    }

    // Calculate pricing for each ticket
    interface TicketData {
      ticketIndex: number
      items: typeof parentOrder.items
      fractionalEntries: FractionalItemEntry[]
      pricing: ReturnType<typeof calculateSplitTicketPricing>
      taxFromInclusive: number
      taxFromExclusive: number
    }

    const ticketDataList: TicketData[] = []
    let previousTicketsTotal = 0
    const originalTotal = Number(parentOrder.total)

    for (let i = 0; i < sortedAssignments.length; i++) {
      const assignment = sortedAssignments[i]
      const isLastTicket = i === sortedAssignments.length - 1

      const ticketItems = assignment.itemIds
        .map(itemId => itemMap.get(itemId))
        .filter((item): item is NonNullable<typeof item> => item !== undefined)

      const fractionalEntries = fractionalItemsByTicket.get(assignment.ticketIndex) || []

      // Build OrderItemInput list including both whole items and fractional items
      const orderItemInputs: OrderItemInput[] = [
        ...ticketItems.map(item => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: Number(item.price),
          modifiers: item.modifiers.map(mod => ({
            name: mod.name,
            price: Number(mod.price),
          })),
        })),
        // Add fractional items as virtual items for pricing calculation
        ...fractionalEntries.map(fe => ({
          id: `${fe.originalItem.id}-frac-${fe.labelIndex}`,
          name: `${fe.originalItem.name} (${fe.labelIndex}/${fe.totalFractions})`,
          quantity: 1,
          price: fe.fractionalPrice,
          modifiers: [] as { name: string; price: number }[],
        })),
      ]

      // Use calculateSplitTicketPricing for discount allocation only (not last-ticket remainder)
      const pricing = calculateSplitTicketPricing(
        orderItemInputs,
        orderDiscount,
        orderSubtotal,
        taxRate,
        roundTo,
        false,       // never isLastTicket — we handle remainder ourselves after tax override
        undefined,
        undefined
      )

      // Override single-rate tax with split-aware calculation
      let ticketInclSub = 0, ticketExclSub = 0
      for (const ti of ticketItems) {
        const mods = ti.modifiers.reduce((s, m) => s + Number(m.price), 0)
        const t = (Number(ti.price) + mods) * ti.quantity
        if (ti.isTaxInclusive) ticketInclSub += t; else ticketExclSub += t
      }
      for (const fe of fractionalEntries) {
        if (fe.originalItem.isTaxInclusive) ticketInclSub += fe.fractionalPrice
        else ticketExclSub += fe.fractionalPrice
      }

      const ticketSub = ticketInclSub + ticketExclSub
      let discIncl = 0, discExcl = 0
      if (pricing.discountTotal > 0 && ticketSub > 0) {
        discIncl = Math.round(pricing.discountTotal * (ticketInclSub / ticketSub) * 100) / 100
        discExcl = Math.round((pricing.discountTotal - discIncl) * 100) / 100
      }

      const ticketTax = calculateSplitTax(
        Math.max(0, ticketInclSub - discIncl),
        Math.max(0, ticketExclSub - discExcl),
        taxRate,
        inclusiveRate
      )

      // Override tax with split-aware values
      pricing.taxAmount = ticketTax.totalTax
      // Total = subtotal + exclusive_tax_only - discount (inclusive tax NOT added)
      let ticketTotal = Math.round((ticketSub + ticketTax.taxFromExclusive - pricing.discountTotal) * 100) / 100

      // Last ticket gets remainder to match parent total exactly
      if (isLastTicket) {
        const targetTotal = originalTotal - previousTicketsTotal
        pricing.roundingAdjustment = Math.round((targetTotal - ticketTotal) * 100) / 100
        ticketTotal = targetTotal
      } else {
        pricing.roundingAdjustment = 0
      }
      pricing.total = ticketTotal

      ticketDataList.push({
        ticketIndex: assignment.ticketIndex,
        items: ticketItems,
        fractionalEntries,
        pricing,
        taxFromInclusive: ticketTax.taxFromInclusive,
        taxFromExclusive: ticketTax.taxFromExclusive,
      })

      previousTicketsTotal += pricing.total
    }

    // Create split orders in a transaction
    const createdSplits = await db.$transaction(async (tx) => {
      // Lock the parent row and re-check status inside the transaction
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`
      const lockedParent = await tx.order.findUnique({ where: { id }, select: { status: true } })
      if (!lockedParent || !['open', 'sent', 'in_progress'].includes(lockedParent.status)) {
        throw new ValidationError('Order status changed — cannot split')
      }

      const splits = []

      for (const ticketData of ticketDataList) {
        const displayNumber = `${parentOrder.orderNumber}-${ticketData.ticketIndex}`

        // Build item create data: whole items + fractional items
        const itemCreateData = [
          // Whole items (copied as-is)
          ...ticketData.items.map(item => ({
            locationId: parentOrder.locationId,
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            itemTotal: item.itemTotal,
            isTaxInclusive: item.isTaxInclusive,
            specialNotes: item.specialNotes,
            seatNumber: item.seatNumber,
            courseNumber: item.courseNumber,
            courseStatus: item.courseStatus,
            kitchenStatus: item.kitchenStatus,
            pricingRuleApplied: item.pricingRuleApplied ?? undefined,
            modifiers: {
              create: item.modifiers.map(mod => ({
                locationId: parentOrder.locationId,
                modifierId: mod.modifierId,
                name: mod.name,
                price: mod.price,
                quantity: mod.quantity,
                preModifier: mod.preModifier,
                depth: mod.depth,
                commissionAmount: mod.commissionAmount,
                linkedMenuItemId: mod.linkedMenuItemId,
                linkedMenuItemName: mod.linkedMenuItemName,
                linkedMenuItemPrice: mod.linkedMenuItemPrice,
                spiritTier: mod.spiritTier,
                linkedBottleProductId: mod.linkedBottleProductId,
                isCustomEntry: mod.isCustomEntry,
                isNoneSelection: mod.isNoneSelection,
                customEntryName: mod.customEntryName,
                customEntryPrice: mod.customEntryPrice,
                swapTargetName: mod.swapTargetName,
                swapTargetItemId: mod.swapTargetItemId,
                swapPricingMode: mod.swapPricingMode,
                swapEffectivePrice: mod.swapEffectivePrice,
              })),
            },
          })),
          // Fractional items (new records with split pricing)
          ...ticketData.fractionalEntries.map(fe => {
            // Calculate proportional modifier prices
            const modPrices = fe.originalItem.modifiers.map(mod =>
              Math.round(Number(mod.price) * fe.fraction * 100) / 100
            )
            const totalModCost = fe.originalItem.modifiers.reduce(
              (sum, mod, i) => sum + modPrices[i] * (mod.quantity || 1), 0
            )
            // Base price = fractionalPrice minus modifier costs (ensures exact sum)
            const basePrice = Math.round((fe.fractionalPrice - totalModCost) * 100) / 100

            return {
              locationId: parentOrder.locationId,
              menuItemId: fe.originalItem.menuItemId,
              name: `${fe.originalItem.name} (${fe.labelIndex}/${fe.totalFractions})`,
              price: basePrice,
              quantity: 1,
              itemTotal: fe.fractionalPrice,
              isTaxInclusive: fe.originalItem.isTaxInclusive,
              specialNotes: fe.originalItem.specialNotes,
              seatNumber: fe.originalItem.seatNumber,
              courseNumber: fe.originalItem.courseNumber,
              courseStatus: fe.originalItem.courseStatus,
              kitchenStatus: fe.originalItem.kitchenStatus,
              pricingRuleApplied: fe.originalItem.pricingRuleApplied ?? undefined,
              modifiers: {
                create: fe.originalItem.modifiers.map((mod, i) => ({
                  locationId: parentOrder.locationId,
                  modifierId: mod.modifierId,
                  name: mod.name,
                  price: modPrices[i],
                  quantity: mod.quantity,
                  preModifier: mod.preModifier,
                  depth: mod.depth,
                  commissionAmount: mod.commissionAmount
                    ? Math.round(Number(mod.commissionAmount) * fe.fraction * 100) / 100
                    : null,
                  linkedMenuItemId: mod.linkedMenuItemId,
                  linkedMenuItemName: mod.linkedMenuItemName,
                  linkedMenuItemPrice: mod.linkedMenuItemPrice,
                  spiritTier: mod.spiritTier,
                  linkedBottleProductId: mod.linkedBottleProductId,
                  isCustomEntry: mod.isCustomEntry,
                  isNoneSelection: mod.isNoneSelection,
                  customEntryName: mod.customEntryName,
                  customEntryPrice: mod.customEntryPrice
                    ? Math.round(Number(mod.customEntryPrice) * fe.fraction * 100) / 100
                    : null,
                  swapTargetName: mod.swapTargetName,
                  swapTargetItemId: mod.swapTargetItemId,
                  swapPricingMode: mod.swapPricingMode,
                  swapEffectivePrice: mod.swapEffectivePrice
                    ? Math.round(Number(mod.swapEffectivePrice) * fe.fraction * 100) / 100
                    : null,
                })),
              },
            }
          }),
        ]

        // TX-KEEP: CREATE — split child order with nested item+modifier creates; no repo method for full split creation
        // Assign full donation to the first ticket only
        const ticketDonation: number = splits.length === 0 ? Number((parentOrder as any).donationAmount ?? 0) : 0
        const ticketTotal: number = ticketDonation > 0
          ? Math.round((ticketData.pricing.total + ticketDonation) * 100) / 100
          : ticketData.pricing.total
        const splitOrder: any = await tx.order.create({
          data: {
            locationId: parentOrder.locationId,
            employeeId: parentOrder.employeeId,
            customerId: parentOrder.customerId,
            orderNumber: parentOrder.orderNumber,
            displayNumber,
            parentOrderId: parentOrder.id,
            splitIndex: ticketData.ticketIndex,
            orderType: parentOrder.orderType,
            tableId: parentOrder.tableId,
            guestCount: 1, // Each split gets 1 guest by default
            tabName: parentOrder.tabName ? `${parentOrder.tabName} (${ticketData.ticketIndex})` : null,
            status: 'open',
            subtotal: ticketData.pricing.subtotal,
            discountTotal: ticketData.pricing.discountTotal,
            taxTotal: ticketData.pricing.taxAmount,
            taxFromInclusive: ticketData.taxFromInclusive,
            taxFromExclusive: ticketData.taxFromExclusive,
            total: ticketTotal,
            notes: parentOrder.notes,
            // Propagate tax-exempt status from parent
            isTaxExempt: (parentOrder as any).isTaxExempt ?? false,
            ...((parentOrder as any).taxExemptReason ? { taxExemptReason: (parentOrder as any).taxExemptReason } : {}),
            ...((parentOrder as any).taxExemptId ? { taxExemptId: (parentOrder as any).taxExemptId } : {}),
            ...((parentOrder as any).taxExemptApprovedBy ? { taxExemptApprovedBy: (parentOrder as any).taxExemptApprovedBy } : {}),
            // Assign donation to first ticket
            ...(ticketDonation > 0 ? { donationAmount: ticketDonation } : {}),
            items: {
              create: itemCreateData,
            },
          },
          include: {
            items: {
              include: { modifiers: true },
            },
          },
        })

        splits.push(splitOrder)
      }

      // Soft-delete ALL parent items — they've been copied to split children.
      // Previously only fractionally-split items were deleted, leaving whole
      // items on the parent with stale totals. This caused "Pay All" to pay
      // the parent's snapshot instead of the real split totals.
      await OrderItemRepository.updateItemsWhere(id, parentOrder.locationId, { deletedAt: null }, { deletedAt: new Date() }, tx)

      // Update parent: status='split', zero out totals (children own all items now)
      const parentDonationAmt = Number((parentOrder as any).donationAmount ?? 0)
      await OrderRepository.updateOrder(parentOrder.id, parentOrder.locationId, {
        status: 'split',
        subtotal: 0,
        taxTotal: 0,
        taxFromInclusive: 0,
        taxFromExclusive: 0,
        total: 0,
        // Zero out parent donation — assigned to first child
        ...(parentDonationAmt > 0 ? { donationAmount: 0 } : {}),
        notes: parentOrder.notes
          ? `${parentOrder.notes}\n[Split into ${splits.length} tickets]`
          : `[Split into ${splits.length} tickets]`,
      }, tx)

      return splits
    })

    // Fire-and-forget socket emit
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split-tickets'))
    void dispatchSplitCreated(parentOrder.locationId, {
      parentOrderId: parentOrder.id,
      parentStatus: 'split',
      splits: createdSplits.map(split => ({
        id: split.id,
        orderNumber: split.orderNumber,
        splitIndex: split.splitIndex!,
        displayNumber: split.displayNumber || `${parentOrder.orderNumber}-${split.splitIndex}`,
        total: Number(split.total),
        itemCount: split.items.length,
        isPaid: false,
      })),
      sourceTerminalId: request.headers.get('x-terminal-id') || undefined,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split-tickets'))
    for (const split of createdSplits) {
      void emitOrderEvent(parentOrder.locationId, split.id, 'ORDER_CREATED', {
        locationId: parentOrder.locationId,
        employeeId: parentOrder.employeeId,
        orderType: parentOrder.orderType,
        tableId: parentOrder.tableId,
        guestCount: 1,
        orderNumber: parentOrder.orderNumber,
        displayNumber: split.displayNumber,
        parentOrderId: parentOrder.id,
        splitIndex: split.splitIndex,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Event emission: parent order status changed to 'split'
    void emitOrderEvent(parentOrder.locationId, id, 'ORDER_CLOSED', {
      closedStatus: 'split',
      reason: `Split into ${createdSplits.length} tickets`,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    pushUpstream()

    return created({
      message: 'Split tickets created successfully',
      parentOrderId: parentOrder.id,
      splitOrders: createdSplits.map(split => ({
        id: split.id,
        splitIndex: split.splitIndex,
        displayNumber: split.displayNumber,
        status: split.status,
        subtotal: Number(split.subtotal),
        discountTotal: Number(split.discountTotal),
        taxTotal: Number(split.taxTotal),
        total: Number(split.total),
        itemCount: split.items.length,
      })),
    })
  } catch (error) {
    return handleApiError(error, 'Failed to create split tickets')
  }
}))

// ============================================
// PATCH - Move an item between split tickets
// ============================================

export const PATCH = withVenue(withAuth(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, itemId, fromSplitId, toSplitId, ways } = body

    // Split item into fractions across checks
    if (action === 'splitItem') {
      if (!itemId || !fromSplitId || !ways || ways < 2 || ways > 10) {
        throw new ValidationError('itemId, fromSplitId, and ways (2-10) are required')
      }

      // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
      let splitItemLocationId = getRequestLocationId()
      if (!splitItemLocationId) {
        const splitItemCheck = await db.order.findFirst({
          where: { id },
          select: { id: true, locationId: true },
        })
        if (!splitItemCheck) throw new NotFoundError('Order')
        splitItemLocationId = splitItemCheck.locationId
      }

      const parentOrder = await OrderRepository.getOrderByIdWithInclude(id, splitItemLocationId, {
        location: true,
        splitOrders: {
          where: { deletedAt: null },
          include: {
            items: { where: { deletedAt: null }, include: { modifiers: true } },
            payments: { where: { status: 'completed' } },
          },
        },
      })
      if (!parentOrder) throw new NotFoundError('Order')

      const sourceSplit = parentOrder.splitOrders.find(s => s.id === fromSplitId)
      if (!sourceSplit) throw new ValidationError('Source split not found')
      if (sourceSplit.payments.length > 0) throw new ValidationError('Cannot split items on a paid check')

      const item = sourceSplit.items.find(i => i.id === itemId)
      if (!item) throw new ValidationError('Item not found in source split')

      const settings = parentOrder.location.settings as {
        tax?: { defaultRate?: number; inclusiveTaxRate?: number }
        priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
      } | null
      // Prefer order-level exclusive tax rate snapshot; fall back to live rate
      const splitItemOrderExclRate = (parentOrder as any).exclusiveTaxRate != null ? Number((parentOrder as any).exclusiveTaxRate) : undefined
      const taxRate = (splitItemOrderExclRate != null && splitItemOrderExclRate >= 0) ? splitItemOrderExclRate : getLocationTaxRate(settings)
      // Prefer order-level snapshot; fall back to location setting with > 0 guard
      const splitItemOrderInclRate = Number(parentOrder.inclusiveTaxRate) || undefined
      const splitItemInclRateRaw = settings?.tax?.inclusiveTaxRate
      const inclusiveRate = splitItemOrderInclRate
        ?? (splitItemInclRateRaw != null && Number.isFinite(splitItemInclRateRaw) && splitItemInclRateRaw > 0
          ? splitItemInclRateRaw / 100 : undefined)

      const fullPrice = Number(item.price) * item.quantity
      const fractionPrice = Math.floor((fullPrice / ways) * 100) / 100
      const lastFractionPrice = Math.round((fullPrice - fractionPrice * (ways - 1)) * 100) / 100

      // Get all non-source splits (unpaid) to distribute fractions
      const targetSplits = parentOrder.splitOrders.filter(s => s.id !== fromSplitId && s.payments.length === 0)

      await db.$transaction(async (tx) => {
        // Update original item to first fraction
        await OrderItemRepository.updateItem(itemId, parentOrder.locationId, {
          price: fractionPrice,
          itemTotal: fractionPrice,
          specialNotes: item.specialNotes
            ? `${item.specialNotes} (1/${ways})`
            : `(1/${ways})`,
        }, tx)

        // Create fraction copies for remaining ways
        for (let i = 1; i < ways; i++) {
          const price = i === ways - 1 ? lastFractionPrice : fractionPrice
          // Place in next available split, or keep in source if not enough splits
          const targetSplit = targetSplits[i - 1] || sourceSplit
          // TX-KEEP: CREATE — fractional copy of split item with nested modifiers; no repo create method
          await tx.orderItem.create({
            data: {
              locationId: parentOrder.locationId,
              orderId: targetSplit.id,
              menuItemId: item.menuItemId,
              name: item.name,
              price: price,
              quantity: item.quantity,
              itemTotal: price,
              isTaxInclusive: item.isTaxInclusive,
              seatNumber: item.seatNumber,
              courseNumber: item.courseNumber,
              status: item.status,
              specialNotes: item.specialNotes
                ? `${item.specialNotes} (${i + 1}/${ways})`
                : `(${i + 1}/${ways})`,
              isCompleted: item.isCompleted,
              modifiers: {
                create: item.modifiers.map(mod => ({
                  modifierId: mod.modifierId,
                  name: mod.name,
                  price: 0,
                  preModifier: mod.preModifier,
                  depth: mod.depth,
                  commissionAmount: null, // Commission stays on original fraction
                  linkedMenuItemId: mod.linkedMenuItemId,
                  linkedMenuItemName: mod.linkedMenuItemName,
                  linkedMenuItemPrice: mod.linkedMenuItemPrice,
                  spiritTier: mod.spiritTier,
                  linkedBottleProductId: mod.linkedBottleProductId,
                  isCustomEntry: mod.isCustomEntry,
                  isNoneSelection: mod.isNoneSelection,
                  customEntryName: mod.customEntryName,
                  customEntryPrice: mod.customEntryPrice,
                  swapTargetName: mod.swapTargetName,
                  swapTargetItemId: mod.swapTargetItemId,
                  swapPricingMode: mod.swapPricingMode,
                  swapEffectivePrice: mod.swapEffectivePrice,
                  location: { connect: { id: parentOrder.locationId } },
                })),
              },
            },
          })
        }

        // Recalculate totals on all affected splits (split-aware tax)
        for (const split of parentOrder.splitOrders) {
          if (split.payments.length > 0) continue
          const freshItems = await OrderItemRepository.getItemsForOrderWithModifiers(split.id, parentOrder.locationId, tx)
          let inclSub = 0, exclSub = 0
          for (const fi of freshItems) {
            const modTotal = (fi.modifiers || []).reduce((ms: number, m: any) => ms + Number(m.price) * (m.quantity ?? 1), 0)
            const t = (Number(fi.price) + modTotal) * fi.quantity
            if (fi.isTaxInclusive) inclSub += t; else exclSub += t
          }
          const subtotal = inclSub + exclSub
          const { taxFromInclusive, taxFromExclusive, totalTax } = calculateSplitTax(inclSub, exclSub, taxRate, inclusiveRate)
          await OrderRepository.updateOrder(split.id, parentOrder.locationId, {
            subtotal,
            taxTotal: totalTax,
            taxFromInclusive,
            taxFromExclusive,
            total: Math.round((subtotal + taxFromExclusive) * 100) / 100,
          }, tx)
        }
      })

      void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
        orderId: id,
        trigger: 'split',
        tableId: parentOrder.tableId || undefined,
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split-tickets'))
      void emitOrderEvent(parentOrder.locationId, fromSplitId, 'ITEM_UPDATED', {
        lineItemId: itemId,
        specialNotes: `Split ${ways} ways`,
      }).catch(err => log.warn({ err }, 'Background task failed'))

      pushUpstream()

      return ok({ message: `Item split ${ways} ways` })
    }

    // Move item between splits (default action)
    if (!itemId || !fromSplitId || !toSplitId) {
      throw new ValidationError('itemId, fromSplitId, and toSplitId are required')
    }

    if (fromSplitId === toSplitId) {
      throw new ValidationError('Cannot move item to the same split')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let moveLocationId = getRequestLocationId()
    if (!moveLocationId) {
      const moveCheck = await db.order.findFirst({
        where: { id },
        select: { id: true, locationId: true },
      })
      if (!moveCheck) throw new NotFoundError('Order')
      moveLocationId = moveCheck.locationId
    }

    // Verify parent order exists and has splits
    const parentOrder = await OrderRepository.getOrderByIdWithInclude(id, moveLocationId, {
      location: true,
      splitOrders: {
        where: { deletedAt: null, id: { in: [fromSplitId, toSplitId] } },
        include: {
          items: { where: { deletedAt: null } },
          payments: { where: { status: 'completed' } },
        },
      },
    })

    if (!parentOrder) throw new NotFoundError('Order')

    const fromSplit = parentOrder.splitOrders.find(s => s.id === fromSplitId)
    const toSplit = parentOrder.splitOrders.find(s => s.id === toSplitId)

    if (!fromSplit) throw new ValidationError('Source split not found')
    if (!toSplit) throw new ValidationError('Destination split not found')
    if (fromSplit.payments.length > 0) throw new ValidationError('Cannot move items from a paid split')
    if (toSplit.payments.length > 0) throw new ValidationError('Cannot move items to a paid split')

    // Verify item exists in source split
    const item = fromSplit.items.find(i => i.id === itemId)
    if (!item) throw new ValidationError('Item not found in source split')

    // Move item and recalculate totals
    const settings = parentOrder.location.settings as {
      tax?: { defaultRate?: number; inclusiveTaxRate?: number }
      priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
    } | null
    // Prefer order-level exclusive tax rate snapshot; fall back to live rate
    const moveOrderExclRate = (parentOrder as any).exclusiveTaxRate != null ? Number((parentOrder as any).exclusiveTaxRate) : undefined
    const taxRate = (moveOrderExclRate != null && moveOrderExclRate >= 0) ? moveOrderExclRate : getLocationTaxRate(settings)
    // Prefer order-level snapshot; fall back to location setting with > 0 guard
    const moveOrderInclRate = Number(parentOrder.inclusiveTaxRate) || undefined
    const moveInclRateRaw = settings?.tax?.inclusiveTaxRate
    const inclusiveRate = moveOrderInclRate
      ?? (moveInclRateRaw != null && Number.isFinite(moveInclRateRaw) && moveInclRateRaw > 0
        ? moveInclRateRaw / 100 : undefined)

    await db.$transaction(async (tx) => {
      // TX-KEEP: RELATION — orderId is a relation FK not in OrderItemUpdateManyMutationInput
      await tx.orderItem.update({
        where: { id: itemId },
        data: { orderId: toSplitId },
      })

      // Recalculate source split totals (split-aware tax)
      const fromItems = fromSplit.items.filter(i => i.id !== itemId)
      let fromInclSub = 0, fromExclSub = 0
      for (const i of fromItems) {
        const t = Number(i.price) * i.quantity
        if (i.isTaxInclusive) fromInclSub += t; else fromExclSub += t
      }
      const fromSubtotal = fromInclSub + fromExclSub
      const fromTax = calculateSplitTax(fromInclSub, fromExclSub, taxRate, inclusiveRate)
      await OrderRepository.updateOrder(fromSplitId, parentOrder.locationId, {
        subtotal: fromSubtotal,
        taxTotal: fromTax.totalTax,
        taxFromInclusive: fromTax.taxFromInclusive,
        taxFromExclusive: fromTax.taxFromExclusive,
        total: Math.round((fromSubtotal + fromTax.taxFromExclusive) * 100) / 100,
      }, tx)

      // Recalculate destination split totals (split-aware tax)
      const toItems = [...toSplit.items, item]
      let toInclSub = 0, toExclSub = 0
      for (const i of toItems) {
        const t = Number(i.price) * i.quantity
        if (i.isTaxInclusive) toInclSub += t; else toExclSub += t
      }
      const toSubtotal = toInclSub + toExclSub
      const toTax = calculateSplitTax(toInclSub, toExclSub, taxRate, inclusiveRate)
      await OrderRepository.updateOrder(toSplitId, parentOrder.locationId, {
        subtotal: toSubtotal,
        taxTotal: toTax.totalTax,
        taxFromInclusive: toTax.taxFromInclusive,
        taxFromExclusive: toTax.taxFromExclusive,
        total: Math.round((toSubtotal + toTax.taxFromExclusive) * 100) / 100,
      }, tx)
    })

    // Fire-and-forget socket emit
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split-tickets'))
    void emitOrderEvent(parentOrder.locationId, fromSplitId, 'ITEM_REMOVED', {
      lineItemId: itemId,
      reason: `Moved to split ${toSplitId}`,
    }).catch(err => log.warn({ err }, 'Background task failed'))
    void emitOrderEvent(parentOrder.locationId, toSplitId, 'ORDER_METADATA_UPDATED', {
      reason: `Received item ${itemId} from split ${fromSplitId}`,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    pushUpstream()

    return ok({ message: 'Item moved successfully' })
  } catch (error) {
    return handleApiError(error, 'Failed to move split item')
  }
}))

// ============================================
// DELETE - Merge split tickets back to parent
// ============================================

export const DELETE = withVenue(withAuth(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let deleteLocationId = getRequestLocationId()
    if (!deleteLocationId) {
      const deleteCheck = await db.order.findFirst({
        where: { id },
        select: { id: true, locationId: true },
      })
      if (!deleteCheck) throw new NotFoundError('Order')
      deleteLocationId = deleteCheck.locationId
    }

    // Get parent order with splits
    const parentOrder = await OrderRepository.getOrderByIdWithInclude(id, deleteLocationId, {
      location: true,
      splitOrders: {
        where: { deletedAt: null },
        include: {
          items: { where: { deletedAt: null }, include: { modifiers: { where: { deletedAt: null } } } },
          payments: true,
        },
      },
    })

    if (!parentOrder) {
      throw new NotFoundError('Order')
    }

    if (parentOrder.splitOrders.length === 0) {
      throw new ValidationError('Order has no splits to merge')
    }

    // Merge splits back in a transaction with row locking to prevent race conditions
    await db.$transaction(async (tx) => {
      // Lock parent + all children to prevent concurrent payment
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "Order" WHERE "parentOrderId" = ${id} FOR UPDATE`

      // TX-KEEP: LOCK — re-check splits inside FOR UPDATE lock to prevent race with concurrent payment
      const splits = await tx.order.findMany({
        where: { parentOrderId: id, locationId: parentOrder.locationId, deletedAt: null },
        include: { payments: { where: { status: 'completed' } } },
      })
      const hasPayments = splits.some(s => s.payments.length > 0)
      if (hasPayments) {
        throw new ValidationError('Cannot merge splits that have payments')
      }

      // Bug 11: Collect child discount totals before soft-deleting
      const childDiscountTotal = splits.reduce((sum, s) => sum + Number(s.discountTotal), 0)

      // Bug 21: Soft-delete child order items to prevent orphan accumulation
      // Each split/unsplit cycle creates new item copies; without cleanup, old copies pile up
      const childOrderIds = splits.map(s => s.id)
      if (childOrderIds.length > 0) {
        // TX-KEEP: BULK — cross-order bulk soft-delete by orderId IN array; no repo method for multi-order item updates
        await tx.orderItem.updateMany({
          where: { orderId: { in: childOrderIds }, locationId: parentOrder.locationId, deletedAt: null },
          data: { deletedAt: new Date() },
        })
      }

      // TX-KEEP: BULK — soft-delete all split child orders by parentOrderId; no repo method for batch split deletion
      await tx.order.updateMany({
        where: { parentOrderId: id, locationId: parentOrder.locationId },
        data: { deletedAt: new Date(), status: 'cancelled' },
      })

      // Restore soft-deleted parent items
      await OrderItemRepository.updateItemsWhere(id, parentOrder.locationId, { deletedAt: { not: null } }, { deletedAt: null }, tx)

      // Restore soft-deleted discounts on the parent order
      await tx.orderDiscount.updateMany({
        where: { orderId: id, locationId: parentOrder.locationId, deletedAt: { not: null } },
        data: { deletedAt: null },
      })

      // Recalculate discountTotal from the actual restored OrderDiscount records
      // This is more accurate than childDiscountTotal when discounts were on the parent before split
      const restoredDiscounts = await tx.orderDiscount.findMany({
        where: { orderId: id, locationId: parentOrder.locationId, deletedAt: null },
        select: { amount: true },
      })
      const restoredDiscountTotal = restoredDiscounts.reduce((sum, d) => sum + Number(d.amount), 0)
      // Use restored records if available; fall back to child totals for discounts applied on splits
      const effectiveDiscountTotal = restoredDiscountTotal > 0 ? restoredDiscountTotal : childDiscountTotal

      // Bug 11: Recalculate parent totals from restored items
      // TX-KEEP: COMPLEX — status-filtered findMany with modifiers include; no repo method for this combination
      const restoredItems = await tx.orderItem.findMany({
        where: { orderId: id, locationId: parentOrder.locationId, deletedAt: null, status: 'active' },
        include: { modifiers: true },
      })

      const parentSubtotal = restoredItems.reduce((sum, item) => {
        const mods = item.modifiers.reduce((s, m) => s + Number(m.price), 0)
        return sum + (Number(item.price) + mods) * item.quantity
      }, 0)

      const settings = parentOrder.location?.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } } | null
      // Prefer order-level exclusive tax rate snapshot; fall back to live rate
      const mergeOrderExclRate = (parentOrder as any).exclusiveTaxRate != null ? Number((parentOrder as any).exclusiveTaxRate) : undefined
      const taxRate = (mergeOrderExclRate != null && mergeOrderExclRate >= 0) ? mergeOrderExclRate : getLocationTaxRate(settings)
      // Prefer order-level snapshot; fall back to location setting with > 0 guard
      const mergeOrderInclRate = Number(parentOrder.inclusiveTaxRate) || undefined
      const mergeInclRateRaw = settings?.tax?.inclusiveTaxRate
      const mergeInclusiveRate = mergeOrderInclRate
        ?? (mergeInclRateRaw != null && Number.isFinite(mergeInclRateRaw) && mergeInclRateRaw > 0
          ? mergeInclRateRaw / 100 : undefined)

      // Split items by tax-inclusive flag for proper split tax calculation
      let mergeInclSub = 0, mergeExclSub = 0
      for (const item of restoredItems) {
        const t = (Number(item.price) + item.modifiers.reduce((s, m) => s + Number(m.price), 0)) * item.quantity
        if (item.isTaxInclusive) mergeInclSub += t; else mergeExclSub += t
      }
      // Allocate discount proportionally between inclusive and exclusive
      let discOnIncl = 0, discOnExcl = 0
      if (effectiveDiscountTotal > 0 && parentSubtotal > 0) {
        const inclShare = mergeInclSub / parentSubtotal
        discOnIncl = Math.round(effectiveDiscountTotal * inclShare * 100) / 100
        discOnExcl = Math.round((effectiveDiscountTotal - discOnIncl) * 100) / 100
      }
      const postDiscInclusive = Math.max(0, mergeInclSub - discOnIncl)
      const postDiscExclusive = Math.max(0, mergeExclSub - discOnExcl)
      const mergeTax = calculateSplitTax(postDiscInclusive, postDiscExclusive, taxRate, mergeInclusiveRate)
      const parentTotal = Math.round((mergeInclSub + mergeExclSub + mergeTax.taxFromExclusive - effectiveDiscountTotal) * 100) / 100
      const parentItemCount = restoredItems.reduce((sum, i) => sum + i.quantity, 0)

      // Restore parent order with recalculated totals
      await OrderRepository.updateOrder(id, parentOrder.locationId, {
        status: 'open',
        subtotal: parentSubtotal,
        discountTotal: effectiveDiscountTotal,
        taxTotal: mergeTax.totalTax,
        taxFromInclusive: mergeTax.taxFromInclusive,
        taxFromExclusive: mergeTax.taxFromExclusive,
        total: parentTotal,
        itemCount: parentItemCount,
        notes: parentOrder.notes?.replace(/\n?\[Split into \d+ tickets\]/, '') || null,
      }, tx)
    })

    // Fire-and-forget socket dispatches + cache invalidation
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split-tickets'))

    invalidateSnapshotCache(parentOrder.locationId)

    if (parentOrder.tableId) {
      void dispatchFloorPlanUpdate(parentOrder.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
    }

    // Event emission: split children closed, parent reopened
    for (const split of parentOrder.splitOrders) {
      void emitOrderEvent(parentOrder.locationId, split.id, 'ORDER_CLOSED', {
        closedStatus: 'cancelled',
        reason: 'Splits merged back to parent',
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }
    void emitOrderEvent(parentOrder.locationId, id, 'ORDER_REOPENED', {
      reason: 'Splits merged back to parent',
    }).catch(err => log.warn({ err }, 'Background task failed'))

    pushUpstream()

    return ok({
      message: 'Split tickets merged successfully',
      parentOrderId: id,
    })
  } catch (error) {
    return handleApiError(error, 'Failed to merge split tickets')
  }
}))
