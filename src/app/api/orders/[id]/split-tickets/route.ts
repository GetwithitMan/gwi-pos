import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationTaxRate } from '@/lib/order-calculations'
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api-errors'
import { validateRequest, idSchema } from '@/lib/validations'
import { z } from 'zod'
import { calculateSplitTicketPricing, type OrderItemInput, type RoundingIncrement } from '@/lib/split-pricing'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'

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

    const order = await db.order.findUnique({
      where: { id },
      include: {
        splitOrders: {
          include: {
            items: {
              include: { modifiers: true },
            },
            employee: {
              select: { id: true, displayName: true, firstName: true, lastName: true },
            },
          },
          orderBy: { splitIndex: 'asc' },
        },
      },
    })

    if (!order) {
      throw new NotFoundError('Order')
    }

    return NextResponse.json({
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
        employee: {
          id: split.employee.id,
          name: split.employee.displayName || `${split.employee.firstName} ${split.employee.lastName}`,
        },
      })),
    })
  } catch (error) {
    return handleApiError(error, 'Failed to get split tickets')
  }
})

// ============================================
// POST - Create split tickets from an order
// ============================================

export const POST = withVenue(async function POST(
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

    // Get the parent order with all items
    const parentOrder = await db.order.findUnique({
      where: { id },
      include: {
        location: true,
        items: {
          where: { deletedAt: null },
          include: { modifiers: true },
        },
      },
    })

    if (!parentOrder) {
      throw new NotFoundError('Order')
    }

    if (parentOrder.status !== 'open') {
      throw new ValidationError('Cannot split a closed order')
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
      tax?: { defaultRate?: number }
      priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
    } | null
    const taxRate = getLocationTaxRate(settings)
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

      const pricing = calculateSplitTicketPricing(
        orderItemInputs,
        orderDiscount,
        orderSubtotal,
        taxRate,
        roundTo,
        isLastTicket,
        originalTotal,
        previousTicketsTotal
      )

      ticketDataList.push({
        ticketIndex: assignment.ticketIndex,
        items: ticketItems,
        fractionalEntries,
        pricing,
      })

      previousTicketsTotal += pricing.total
    }

    // Create split orders in a transaction
    const createdSplits = await db.$transaction(async (tx) => {
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
            specialNotes: item.specialNotes,
            seatNumber: item.seatNumber,
            courseNumber: item.courseNumber,
            courseStatus: item.courseStatus,
            kitchenStatus: item.kitchenStatus,
            modifiers: {
              create: item.modifiers.map(mod => ({
                locationId: parentOrder.locationId,
                modifierId: mod.modifierId,
                name: mod.name,
                price: mod.price,
                quantity: mod.quantity,
                preModifier: mod.preModifier,
              })),
            },
          })),
          // Fractional items (new records with split pricing)
          ...ticketData.fractionalEntries.map(fe => ({
            locationId: parentOrder.locationId,
            menuItemId: fe.originalItem.menuItemId,
            name: `${fe.originalItem.name} (${fe.labelIndex}/${fe.totalFractions})`,
            price: fe.fractionalPrice,
            quantity: 1,
            itemTotal: fe.fractionalPrice,
            specialNotes: fe.originalItem.specialNotes,
            seatNumber: fe.originalItem.seatNumber,
            courseNumber: fe.originalItem.courseNumber,
            courseStatus: fe.originalItem.courseStatus,
            kitchenStatus: fe.originalItem.kitchenStatus,
            modifiers: {
              create: fe.originalItem.modifiers.map(mod => ({
                locationId: parentOrder.locationId,
                modifierId: mod.modifierId,
                name: mod.name,
                price: 0, // Modifier price already baked into fractionalPrice
                quantity: mod.quantity,
                preModifier: mod.preModifier,
              })),
            },
          })),
        ]

        // Create the split order
        const splitOrder = await tx.order.create({
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
            subtotal: ticketData.pricing.subtotal - ticketData.pricing.discountTotal,
            discountTotal: ticketData.pricing.discountTotal,
            taxTotal: ticketData.pricing.taxAmount,
            total: ticketData.pricing.total,
            notes: parentOrder.notes,
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

      // Soft-delete original items that were fractionally split
      if (splitItems.length > 0) {
        const splitOriginalIds = splitItems.map(si => si.originalItemId)
        await tx.orderItem.updateMany({
          where: {
            id: { in: splitOriginalIds },
            orderId: id,
            locationId: parentOrder.locationId,
          },
          data: { deletedAt: new Date() },
        })
      }

      // Update parent order status to indicate it was split
      await tx.order.update({
        where: { id: parentOrder.id },
        data: {
          status: 'split',
          notes: parentOrder.notes
            ? `${parentOrder.notes}\n[Split into ${splits.length} tickets]`
            : `[Split into ${splits.length} tickets]`,
        },
      })

      return splits
    })

    // Fire-and-forget socket emit
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(() => {})

    return NextResponse.json({
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
    }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Failed to create split tickets')
  }
})

// ============================================
// DELETE - Merge split tickets back to parent
// ============================================

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get parent order with splits
    const parentOrder = await db.order.findUnique({
      where: { id },
      include: {
        splitOrders: {
          include: {
            items: { include: { modifiers: true } },
            payments: true,
          },
        },
      },
    })

    if (!parentOrder) {
      throw new NotFoundError('Order')
    }

    if (parentOrder.splitOrders.length === 0) {
      throw new ValidationError('Order has no splits to merge')
    }

    // Check if any splits have payments
    const hasPayments = parentOrder.splitOrders.some(split => split.payments.length > 0)
    if (hasPayments) {
      throw new ValidationError('Cannot merge splits that have payments')
    }

    // Merge splits back in a transaction
    await db.$transaction(async (tx) => {
      // Delete all split orders (cascade deletes items)
      await tx.order.deleteMany({
        where: { parentOrderId: id },
      })

      // Restore parent order status
      await tx.order.update({
        where: { id },
        data: {
          status: 'open',
          notes: parentOrder.notes?.replace(/\n?\[Split into \d+ tickets\]/, '') || null,
        },
      })

      // Restore any soft-deleted split items
      await tx.orderItem.updateMany({
        where: {
          orderId: id,
          locationId: parentOrder.locationId,
          deletedAt: { not: null },
        },
        data: { deletedAt: null },
      })
    })

    return NextResponse.json({
      message: 'Split tickets merged successfully',
      parentOrderId: id,
    })
  } catch (error) {
    return handleApiError(error, 'Failed to merge split tickets')
  }
})
