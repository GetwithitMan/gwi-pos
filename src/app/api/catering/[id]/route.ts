import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('catering')

const VALID_STATUSES = ['inquiry', 'quoted', 'confirmed', 'in_preparation', 'delivered', 'completed', 'cancelled'] as const
type CateringStatus = typeof VALID_STATUSES[number]

// Valid status transitions
const ALLOWED_TRANSITIONS: Record<string, CateringStatus[]> = {
  inquiry: ['quoted', 'cancelled'],
  quoted: ['confirmed', 'cancelled'],
  confirmed: ['in_preparation', 'cancelled'],
  in_preparation: ['delivered', 'cancelled'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
}

// GET /api/catering/[id] — get catering order details
export const GET = withVenue(async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const orders = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CateringOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL LIMIT 1`

    if (orders.length === 0) {
      return notFound('Catering order not found')
    }

    const order = orders[0]

    // Fetch items
    const items = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CateringOrderItem"
       WHERE "cateringOrderId" = ${id} AND "deletedAt" IS NULL
       ORDER BY "createdAt" ASC`

    return ok({ ...order, items })
  } catch (error) {
    console.error('Failed to fetch catering order:', error)
    return err('Failed to fetch catering order', 500)
  }
})

// PUT /api/catering/[id] — update catering order (status changes, item edits)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, items, notes, guestCount, eventDate, eventTime, deliveryAddress, assignedTo } = body as {
      status?: CateringStatus
      items?: Array<{
        menuItemId?: string
        name: string
        quantity: number
        unitPrice: number
        specialInstructions?: string
      }>
      notes?: string
      guestCount?: number
      eventDate?: string
      eventTime?: string
      deliveryAddress?: string
      assignedTo?: string
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId

    // Fetch current order
    const orders = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CateringOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL LIMIT 1`
    if (orders.length === 0) {
      return notFound('Catering order not found')
    }

    const currentOrder = orders[0]
    const currentStatus = currentOrder.status as string

    // Status transition validation
    if (status && status !== currentStatus) {
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || []
      if (!allowed.includes(status)) {
        return err(`Cannot transition from "${currentStatus}" to "${status}". Allowed: ${allowed.join(', ')}`)
      }

      // Business rules for specific transitions
      if (status === 'confirmed') {
        // Check deposit paid (if required)
        const depositRequired = Number(currentOrder.depositRequired) || 0
        const depositPaid = Number(currentOrder.depositPaid) || 0
        if (depositRequired > 0 && depositPaid < depositRequired) {
          return err(`Deposit of $${depositRequired.toFixed(2)} required before confirmation. Paid: $${depositPaid.toFixed(2)}`)
        }
      }
    }

    // Build update SET clauses
    const setClauses: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const updateParams: unknown[] = []
    let paramIdx = 1

    if (status) {
      setClauses.push(`"status" = $${paramIdx}`)
      updateParams.push(status)
      paramIdx++

      // Set timestamp fields based on status
      switch (status) {
        case 'quoted':
          setClauses.push('"quotedAt" = CURRENT_TIMESTAMP')
          break
        case 'confirmed':
          setClauses.push('"confirmedAt" = CURRENT_TIMESTAMP')
          break
        case 'in_preparation':
          setClauses.push('"prepStartedAt" = CURRENT_TIMESTAMP')
          break
        case 'delivered':
          setClauses.push('"deliveredAt" = CURRENT_TIMESTAMP')
          break
        case 'completed':
          setClauses.push('"completedAt" = CURRENT_TIMESTAMP')
          break
        case 'cancelled':
          setClauses.push('"cancelledAt" = CURRENT_TIMESTAMP')
          if (body.cancelReason) {
            setClauses.push(`"cancelReason" = $${paramIdx}`)
            updateParams.push(body.cancelReason)
            paramIdx++
          }
          break
      }
    }

    if (notes !== undefined) {
      setClauses.push(`"notes" = $${paramIdx}`)
      updateParams.push(notes)
      paramIdx++
    }

    if (guestCount !== undefined) {
      setClauses.push(`"guestCount" = $${paramIdx}`)
      updateParams.push(guestCount)
      paramIdx++
    }

    if (eventDate !== undefined) {
      setClauses.push(`"eventDate" = $${paramIdx}::date`)
      updateParams.push(eventDate)
      paramIdx++
    }

    if (eventTime !== undefined) {
      setClauses.push(`"eventTime" = $${paramIdx}`)
      updateParams.push(eventTime)
      paramIdx++
    }

    if (deliveryAddress !== undefined) {
      setClauses.push(`"deliveryAddress" = $${paramIdx}`)
      updateParams.push(deliveryAddress)
      paramIdx++
    }

    if (assignedTo !== undefined) {
      setClauses.push(`"assignedTo" = $${paramIdx}`)
      updateParams.push(assignedTo)
      paramIdx++
    }

    // Wrap order update + item replacement + financial recalculation in a transaction
    await db.$transaction(async (tx) => {
      // Pessimistic lock: prevent concurrent updates from colliding
      await tx.$queryRaw`SELECT id FROM "CateringOrder" WHERE "id" = ${id} FOR UPDATE`

      // Update the order
      updateParams.push(id)
      // eslint-disable-next-line -- dynamic SET clauses + spread params require $executeRawUnsafe; all values are parameterized
      await tx.$executeRawUnsafe(
        `UPDATE "CateringOrder" SET ${setClauses.join(', ')} WHERE "id" = $${paramIdx}`,
        ...updateParams,
      )

      // Update items if provided (only if before confirmation)
      if (items && ['inquiry', 'quoted'].includes(currentStatus)) {
        // Soft-delete existing items
        await tx.$executeRaw`UPDATE "CateringOrderItem" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "cateringOrderId" = ${id} AND "deletedAt" IS NULL`

        // Insert new items and recalculate totals
        let subtotal = 0
        let totalVolumeDiscount = 0

        for (const item of items) {
          const lineTotal = item.unitPrice * item.quantity
          const discountPct = item.quantity >= 50 ? 20 : item.quantity >= 25 ? 15 : item.quantity >= 10 ? 10 : 0
          const discountAmount = Math.round(lineTotal * discountPct) / 100
          const discountedLineTotal = Math.round((lineTotal - discountAmount) * 100) / 100

          subtotal += lineTotal
          totalVolumeDiscount += discountAmount

          await tx.$executeRaw`INSERT INTO "CateringOrderItem" (
              "id", "cateringOrderId", "menuItemId", "name", "quantity", "unitPrice",
              "lineTotal", "volumeDiscountPct", "discountedLineTotal", "specialInstructions",
              "createdAt", "updatedAt"
            ) VALUES (
              gen_random_uuid()::text, ${id}, ${item.menuItemId || null}, ${item.name}, ${item.quantity}, ${item.unitPrice},
              ${lineTotal}, ${discountPct}, ${discountedLineTotal}, ${item.specialInstructions || null},
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )`
        }

        // Recalculate financials
        const discountedSubtotal = subtotal - totalVolumeDiscount
        const serviceFeeRate = Number(currentOrder.serviceFee) > 0
          ? Number(currentOrder.serviceFee) / (Number(currentOrder.subtotal) || 1)
          : 0.18
        const serviceFee = Math.round(discountedSubtotal * serviceFeeRate * 100) / 100
        const deliveryFee = Number(currentOrder.deliveryFee) || 0
        const taxRules = await tx.taxRule.findMany({
          where: { locationId: currentOrder.locationId as string, isActive: true, isInclusive: false, deletedAt: null },
          select: { rate: true },
        })
        const taxRate = taxRules.reduce((sum, r) => sum + Number(r.rate), 0)
        const taxTotal = Math.round(discountedSubtotal * taxRate * 100) / 100
        const total = Math.round((discountedSubtotal + serviceFee + deliveryFee + taxTotal) * 100) / 100

        await tx.$executeRaw`UPDATE "CateringOrder" SET
            "subtotal" = ${discountedSubtotal}, "volumeDiscount" = ${totalVolumeDiscount}, "serviceFee" = ${serviceFee},
            "taxTotal" = ${taxTotal}, "total" = ${total}, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = ${id}`
      }
    })

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId: currentOrder.locationId as string,
        employeeId: employeeId || 'system',
        action: status ? `catering_status_${status}` : 'catering_order_updated',
        entityType: 'catering_order',
        entityId: id,
        details: {
          previousStatus: currentStatus,
          newStatus: status || currentStatus,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    void emitToLocation(currentOrder.locationId as string, 'orders:list-changed', { trigger: 'mutation', locationId: currentOrder.locationId as string }).catch(err => log.warn({ err }, 'socket emit failed'))

    // Fetch updated order
    const updatedOrders = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CateringOrder" WHERE "id" = ${id} LIMIT 1`
    const updatedItems = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CateringOrderItem" WHERE "cateringOrderId" = ${id} AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`

    return ok({ ...updatedOrders[0], items: updatedItems })
  } catch (error) {
    console.error('Failed to update catering order:', error)
    return err('Failed to update catering order', 500)
  }
})

// DELETE /api/catering/[id] — cancel/soft-delete a catering order
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { cancelReason } = body as { cancelReason?: string }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body?.employeeId

    // Fetch current order
    const orders = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "CateringOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL LIMIT 1`
    if (orders.length === 0) {
      return notFound('Catering order not found')
    }

    const currentOrder = orders[0]
    const currentStatus = currentOrder.status as string

    // Cannot cancel completed orders
    if (currentStatus === 'completed') {
      return err('Cannot cancel a completed order')
    }

    // Determine if refund is applicable (only if deposit was paid)
    const depositPaid = Number(currentOrder.depositPaid) || 0
    let refundNote = ''
    if (depositPaid > 0) {
      // If cancelled after confirmation (in_preparation/delivered), may not be refundable
      if (['in_preparation', 'delivered'].includes(currentStatus)) {
        refundNote = `Deposit of $${depositPaid.toFixed(2)} is non-refundable for orders cancelled during preparation/delivery.`
      } else {
        refundNote = `Deposit of $${depositPaid.toFixed(2)} may be refundable. Process refund separately.`
      }
    }

    await db.$executeRaw`UPDATE "CateringOrder" SET
        "status" = 'cancelled',
        "cancelledAt" = CURRENT_TIMESTAMP,
        "cancelReason" = ${cancelReason || 'Cancelled by staff'},
        "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ${id}`

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId: currentOrder.locationId as string,
        employeeId: employeeId || 'system',
        action: 'catering_order_cancelled',
        entityType: 'catering_order',
        entityId: id,
        details: {
          previousStatus: currentStatus,
          cancelReason: cancelReason || 'Cancelled by staff',
          depositPaid,
          refundNote,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    void emitToLocation(currentOrder.locationId as string, 'orders:list-changed', { trigger: 'mutation', locationId: currentOrder.locationId as string }).catch(err => log.warn({ err }, 'socket emit failed'))

    return ok({
        id,
        status: 'cancelled',
        message: 'Catering order cancelled',
        refundNote,
      })
  } catch (error) {
    console.error('Failed to cancel catering order:', error)
    return err('Failed to cancel catering order', 500)
  }
})
