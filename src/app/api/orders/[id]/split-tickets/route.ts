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
        isPaid: split.status === 'paid',
        paidAmount: split.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0),
        employee: {
          id: split.employee.id,
          name: split.employee.displayName || `${split.employee.firstName} ${split.employee.lastName}`,
        },
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

      // Soft-delete ALL parent items — they've been copied to split children.
      // Previously only fractionally-split items were deleted, leaving whole
      // items on the parent with stale totals. This caused "Pay All" to pay
      // the parent's snapshot instead of the real split totals.
      await tx.orderItem.updateMany({
        where: {
          orderId: id,
          locationId: parentOrder.locationId,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      })

      // Update parent: status='split', zero out totals (children own all items now)
      await tx.order.update({
        where: { id: parentOrder.id },
        data: {
          status: 'split',
          subtotal: 0,
          taxTotal: 0,
          total: 0,
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
// PATCH - Move an item between split tickets
// ============================================

export const PATCH = withVenue(async function PATCH(
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

      const parentOrder = await db.order.findUnique({
        where: { id },
        include: {
          location: true,
          splitOrders: {
            where: { deletedAt: null },
            include: {
              items: { where: { deletedAt: null }, include: { modifiers: true } },
              payments: { where: { status: 'completed' } },
            },
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
        tax?: { defaultRate?: number }
        priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
      } | null
      const taxRate = getLocationTaxRate(settings)

      const fullPrice = Number(item.price) * item.quantity
      const fractionPrice = Math.floor((fullPrice / ways) * 100) / 100
      const lastFractionPrice = Math.round((fullPrice - fractionPrice * (ways - 1)) * 100) / 100

      // Get all non-source splits (unpaid) to distribute fractions
      const targetSplits = parentOrder.splitOrders.filter(s => s.id !== fromSplitId && s.payments.length === 0)

      await db.$transaction(async (tx) => {
        // Update original item to first fraction
        await tx.orderItem.update({
          where: { id: itemId },
          data: {
            price: fractionPrice,
            itemTotal: fractionPrice,
            specialNotes: item.specialNotes
              ? `${item.specialNotes} (1/${ways})`
              : `(1/${ways})`,
          },
        })

        // Create fraction copies for remaining ways
        for (let i = 1; i < ways; i++) {
          const price = i === ways - 1 ? lastFractionPrice : fractionPrice
          // Place in next available split, or keep in source if not enough splits
          const targetSplit = targetSplits[i - 1] || sourceSplit
          await tx.orderItem.create({
            data: {
              locationId: parentOrder.locationId,
              orderId: targetSplit.id,
              menuItemId: item.menuItemId,
              name: item.name,
              price: price,
              quantity: item.quantity,
              itemTotal: price,
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
                  location: { connect: { id: parentOrder.locationId } },
                })),
              },
            },
          })
        }

        // Recalculate totals on all affected splits
        for (const split of parentOrder.splitOrders) {
          if (split.payments.length > 0) continue
          const freshItems = await tx.orderItem.findMany({
            where: { orderId: split.id, deletedAt: null },
          })
          const subtotal = freshItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0)
          const tax = Math.round(subtotal * taxRate * 100) / 100
          await tx.order.update({
            where: { id: split.id },
            data: {
              subtotal,
              taxTotal: tax,
              total: Math.round((subtotal + tax) * 100) / 100,
            },
          })
        }
      })

      void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
        orderId: id,
        trigger: 'split',
        tableId: parentOrder.tableId || undefined,
      }).catch(() => {})

      return NextResponse.json({ message: `Item split ${ways} ways` })
    }

    // Move item between splits (default action)
    if (!itemId || !fromSplitId || !toSplitId) {
      throw new ValidationError('itemId, fromSplitId, and toSplitId are required')
    }

    if (fromSplitId === toSplitId) {
      throw new ValidationError('Cannot move item to the same split')
    }

    // Verify parent order exists and has splits
    const parentOrder = await db.order.findUnique({
      where: { id },
      include: {
        location: true,
        splitOrders: {
          where: { deletedAt: null, id: { in: [fromSplitId, toSplitId] } },
          include: {
            items: { where: { deletedAt: null } },
            payments: { where: { status: 'completed' } },
          },
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
      tax?: { defaultRate?: number }
      priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
    } | null
    const taxRate = getLocationTaxRate(settings)

    await db.$transaction(async (tx) => {
      // Move item to destination split
      await tx.orderItem.update({
        where: { id: itemId },
        data: { orderId: toSplitId },
      })

      // Recalculate source split totals
      const fromItems = fromSplit.items.filter(i => i.id !== itemId)
      const fromSubtotal = fromItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0)
      const fromTax = Math.round(fromSubtotal * taxRate * 100) / 100
      await tx.order.update({
        where: { id: fromSplitId },
        data: {
          subtotal: fromSubtotal,
          taxTotal: fromTax,
          total: Math.round((fromSubtotal + fromTax) * 100) / 100,
        },
      })

      // Recalculate destination split totals
      const toItems = [...toSplit.items, item]
      const toSubtotal = toItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0)
      const toTax = Math.round(toSubtotal * taxRate * 100) / 100
      await tx.order.update({
        where: { id: toSplitId },
        data: {
          subtotal: toSubtotal,
          taxTotal: toTax,
          total: Math.round((toSubtotal + toTax) * 100) / 100,
        },
      })
    })

    // Fire-and-forget socket emit
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: id,
      trigger: 'split',
      tableId: parentOrder.tableId || undefined,
    }).catch(() => {})

    return NextResponse.json({ message: 'Item moved successfully' })
  } catch (error) {
    return handleApiError(error, 'Failed to move split item')
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
