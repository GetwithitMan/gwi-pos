import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

const PayAllSplitsSchema = z.object({
  method: z.enum(['cash', 'credit', 'debit']),
  employeeId: z.string().min(1, 'employeeId is required'),
  terminalId: z.string().optional(),
  // Card details (required for credit/debit)
  cardBrand: z.string().optional(),
  cardLast4: z.string().optional(),
  authCode: z.string().optional(),
  datacapRecordNo: z.string().optional(),
  datacapRefNumber: z.string().optional(),
  datacapSequenceNo: z.string().optional(),
  entryMethod: z.string().optional(),
  amountAuthorized: z.number().optional(),
})

// POST - Pay all unpaid split children of a parent order in one batch
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: parentOrderId } = await params

  try {
    const body = await request.json()

    const validation = PayAllSplitsSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.format() },
        { status: 400 }
      )
    }

    const { method, employeeId, terminalId, cardBrand, cardLast4, authCode, datacapRecordNo, datacapRefNumber, datacapSequenceNo, entryMethod, amountAuthorized } = validation.data

    // Fetch parent order with its split children
    const parentOrder = await db.order.findUnique({
      where: { id: parentOrderId },
      include: {
        splitOrders: {
          where: { deletedAt: null },
          include: {
            payments: { where: { status: 'completed' }, select: { totalAmount: true } },
          },
        },
      },
    })

    if (!parentOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (parentOrder.status !== 'split') {
      return NextResponse.json(
        { error: 'Order is not a split parent. Only orders with status "split" can use this endpoint.' },
        { status: 400 }
      )
    }

    // Find unpaid split children
    const unpaidSplits = parentOrder.splitOrders.filter(s => s.status !== 'paid')

    if (unpaidSplits.length === 0) {
      return NextResponse.json(
        { error: 'All split tickets are already paid' },
        { status: 400 }
      )
    }

    // Calculate combined total
    const combinedTotal = unpaidSplits.reduce((sum, s) => sum + Number(s.total), 0)

    // Process all payments atomically
    const now = new Date()

    await db.$transaction(async (tx) => {
      // Create a payment and mark each unpaid split as paid
      for (const split of unpaidSplits) {
        const splitTotal = Number(split.total)

        await tx.payment.create({
          data: {
            locationId: split.locationId,
            orderId: split.id,
            employeeId,
            terminalId: terminalId || null,
            amount: splitTotal,
            tipAmount: 0,
            totalAmount: splitTotal,
            paymentMethod: method,
            status: 'completed',
            // Card details (shared across all splits from single card transaction)
            ...(cardBrand && { cardBrand }),
            ...(cardLast4 && { cardLast4 }),
            ...(authCode && { authCode }),
            ...(datacapRecordNo && { datacapRecordNo }),
            ...(datacapRefNumber && { datacapRefNumber }),
            ...(datacapSequenceNo && { datacapSequenceNo }),
            ...(entryMethod && { entryMethod }),
            ...(amountAuthorized && { amountAuthorized }),
          },
        })

        await tx.order.update({
          where: { id: split.id },
          data: {
            status: 'paid',
            paidAt: now,
          },
        })
      }

      // Mark parent order as paid
      await tx.order.update({
        where: { id: parentOrderId },
        data: {
          status: 'paid',
          paidAt: now,
          closedAt: now,
        },
      })

      // Reset table if parent had one
      if (parentOrder.tableId) {
        await tx.table.update({
          where: { id: parentOrder.tableId },
          data: { status: 'available' },
        })
      }
    })

    // Fire-and-forget socket events
    void emitToLocation(parentOrder.locationId, 'orders:list-changed', {
      orderId: parentOrderId,
      status: 'paid',
      trigger: 'pay-all-splits',
    }).catch(() => {})

    void dispatchOpenOrdersChanged(parentOrder.locationId, {
      trigger: 'paid',
      orderId: parentOrderId,
      tableId: parentOrder.tableId || undefined,
    }, { async: true }).catch(() => {})

    if (parentOrder.tableId) {
      void dispatchFloorPlanUpdate(parentOrder.locationId, { async: true }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      splitsPaid: unpaidSplits.length,
      totalAmount: Math.round(combinedTotal * 100) / 100,
      parentOrderId,
    })
  } catch (error) {
    console.error('Failed to pay all splits:', error)
    return NextResponse.json(
      { error: 'Failed to pay all splits' },
      { status: 500 }
    )
  }
})
