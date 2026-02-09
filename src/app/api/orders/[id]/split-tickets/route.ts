import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationTaxRate } from '@/lib/order-calculations'
import { handleApiError, NotFoundError, ValidationError } from '@/lib/api-errors'
import { validateRequest, idSchema } from '@/lib/validations'
import { z } from 'zod'
import { calculateSplitTicketPricing, type OrderItemInput, type RoundingIncrement } from '@/lib/split-pricing'

// ============================================
// Validation Schemas
// ============================================

const splitAssignmentSchema = z.object({
  ticketIndex: z.number().int().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
})

const createSplitTicketsSchema = z.object({
  assignments: z.array(splitAssignmentSchema).min(2, 'At least 2 tickets required'),
})

// ============================================
// GET - Get all split tickets for an order
// ============================================

export async function GET(
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
}

// ============================================
// POST - Create split tickets from an order
// ============================================

export async function POST(
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

    const { assignments } = validation.data

    // Get the parent order with all items
    const parentOrder = await db.order.findUnique({
      where: { id },
      include: {
        location: true,
        items: {
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

    // Validate that all items are assigned
    const allItemIds = new Set(parentOrder.items.map(item => item.id))
    const assignedItemIds = new Set<string>()

    for (const assignment of assignments) {
      for (const itemId of assignment.itemIds) {
        if (!allItemIds.has(itemId)) {
          throw new ValidationError(`Item ${itemId} not found in order`)
        }
        if (assignedItemIds.has(itemId)) {
          throw new ValidationError(`Item ${itemId} assigned to multiple tickets`)
        }
        assignedItemIds.add(itemId)
      }
    }

    if (assignedItemIds.size !== allItemIds.size) {
      throw new ValidationError('All items must be assigned to a ticket')
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

    // Calculate pricing for each ticket
    interface TicketData {
      ticketIndex: number
      items: typeof parentOrder.items
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

      // Convert to OrderItemInput format
      const orderItemInputs: OrderItemInput[] = ticketItems.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
        modifiers: item.modifiers.map(mod => ({
          name: mod.name,
          price: Number(mod.price),
        })),
      }))

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
        pricing,
      })

      previousTicketsTotal += pricing.total
    }

    // Create split orders in a transaction
    const createdSplits = await db.$transaction(async (tx) => {
      const splits = []

      for (const ticketData of ticketDataList) {
        const displayNumber = `${parentOrder.orderNumber}-${ticketData.ticketIndex}`

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
              create: ticketData.items.map(item => ({
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
}

// ============================================
// DELETE - Merge split tickets back to parent
// ============================================

export async function DELETE(
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
    })

    return NextResponse.json({
      message: 'Split tickets merged successfully',
      parentOrderId: id,
    })
  } catch (error) {
    return handleApiError(error, 'Failed to merge split tickets')
  }
}
