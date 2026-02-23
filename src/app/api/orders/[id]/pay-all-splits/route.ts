import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { deductInventoryForOrder } from '@/lib/inventory-calculations'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { parseSettings } from '@/lib/settings'

const PayAllSplitsSchema = z.object({
  method: z.enum(['cash', 'credit', 'debit']),
  employeeId: z.string().min(1, 'employeeId is required'),
  terminalId: z.string().optional(),
  idempotencyKey: z.string().optional(),
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

    const { method, employeeId, terminalId, idempotencyKey, cardBrand, cardLast4, authCode, datacapRecordNo, datacapRefNumber, datacapSequenceNo, entryMethod, amountAuthorized } = validation.data

    // Fetch parent order with its split children
    const parentOrder = await db.order.findUnique({
      where: { id: parentOrderId },
      include: {
        location: true,
        customer: true,
        splitOrders: {
          where: { deletedAt: null },
          include: {
            payments: { where: { status: 'completed' }, select: { totalAmount: true, idempotencyKey: true } },
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

    // Idempotency check — if any split already has a payment with this key, it's a duplicate
    if (idempotencyKey) {
      const existingPayment = parentOrder.splitOrders
        .flatMap(s => s.payments)
        .find(p => p.idempotencyKey === idempotencyKey)
      if (existingPayment) {
        return NextResponse.json({ data: {
          success: true,
          duplicate: true,
          parentOrderId,
          message: 'Duplicate payment detected — already processed',
        } })
      }
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
            ...(idempotencyKey && { idempotencyKey }),
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
    void dispatchOpenOrdersChanged(parentOrder.locationId, {
      trigger: 'paid',
      orderId: parentOrderId,
      tableId: parentOrder.tableId || undefined,
    }, { async: true }).catch(() => {})

    if (parentOrder.tableId) {
      void dispatchFloorPlanUpdate(parentOrder.locationId, { async: true }).catch(() => {})
    }

    // Fire-and-forget: inventory deductions for each split child (parent has zero items after split)
    for (const split of unpaidSplits) {
      void deductInventoryForOrder(split.id, employeeId).catch(err => {
        console.error(`[PAYMENT-SAFETY] Inventory deduction failed for split ${split.id}:`, err)
      })
    }

    // Fire-and-forget: loyalty points if customer exists and loyalty enabled
    const settings = parseSettings(parentOrder.location.settings)

    // Fire-and-forget: tip allocation for splits that have tips
    for (const split of unpaidSplits) {
      const splitTipTotal = Number(split.tipTotal || 0)
      if (splitTipTotal > 0 && split.employeeId) {
        void allocateTipsForPayment({
          locationId: split.locationId,
          orderId: split.id,
          primaryEmployeeId: split.employeeId,
          createdPayments: [{
            id: split.id,
            paymentMethod: method,
            tipAmount: splitTipTotal,
          }],
          totalTipsDollars: splitTipTotal,
          tipBankSettings: settings.tipBank,
        }).catch(err => {
          console.error(`[PAYMENT-SAFETY] Tip allocation failed for split ${split.id}:`, err)
        })
      }
    }
    if (parentOrder.customer && settings.loyalty.enabled) {
      const earningBase = settings.loyalty.earnOnSubtotal
        ? Number(parentOrder.splitOrders.reduce((sum, s) => sum + Number(s.subtotal), 0))
        : combinedTotal
      if (earningBase >= settings.loyalty.minimumEarnAmount) {
        const pointsEarned = Math.floor(earningBase * settings.loyalty.pointsPerDollar)
        if (pointsEarned > 0) {
          void db.customer.update({
            where: { id: parentOrder.customer.id },
            data: {
              loyaltyPoints: { increment: pointsEarned },
              totalSpent: { increment: combinedTotal },
              totalOrders: { increment: 1 },
              lastVisit: new Date(),
            },
          }).catch(err => {
            console.error('Background loyalty points failed (pay-all-splits):', err)
          })
        }
      }
    }

    return NextResponse.json({ data: {
      success: true,
      splitsPaid: unpaidSplits.length,
      totalAmount: Math.round(combinedTotal * 100) / 100,
      parentOrderId,
    } })
  } catch (error) {
    console.error('Failed to pay all splits:', error)
    return NextResponse.json(
      { error: 'Failed to pay all splits' },
      { status: 500 }
    )
  }
})
