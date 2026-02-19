import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'

// POST - Re-authorize (IncrementalAuth) when bottle service tab exceeds deposit
// Called when bartender acknowledges re-auth alert, or manually from tab management
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId, additionalAmount } = body

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
    }

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null, isBottleService: true },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized', isDefault: true },
          take: 1,
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Bottle service order not found' }, { status: 404 })
    }

    if (order.cards.length === 0) {
      return NextResponse.json({ error: 'No authorized card on this bottle service tab' }, { status: 400 })
    }

    const defaultCard = order.cards[0]
    const readerId = defaultCard.readerId
    const recordNo = defaultCard.recordNo

    // Calculate increment: use provided amount or default to deposit amount again
    const incrementAmount = additionalAmount || Number(order.bottleServiceDeposit) || 500

    await validateReader(readerId, order.locationId)
    const client = await requireDatacapClient(order.locationId)

    const response = await client.incrementalAuth(readerId, {
      recordNo,
      additionalAmount: incrementAmount,
    })

    const error = parseError(response)
    const approved = response.cmdStatus === 'Approved'

    if (approved) {
      // Update card auth amount
      const newAuthAmount = Number(defaultCard.authAmount) + incrementAmount
      await db.orderCard.update({
        where: { id: defaultCard.id },
        data: { authAmount: newAuthAmount },
      })

      // Update order pre-auth amount
      await db.order.update({
        where: { id: orderId },
        data: {
          preAuthAmount: newAuthAmount,
        },
      })

      // Fire-and-forget socket dispatch for cross-terminal sync
      void dispatchOrderUpdated(order.locationId, {
        orderId,
        changes: ['bottle-service-reauth', 'preAuthAmount'],
      }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        approved,
        incrementAmount,
        newAuthorizedAmount: approved ? Number(defaultCard.authAmount) + incrementAmount : Number(defaultCard.authAmount),
        error: error ? { code: error.code, message: error.text, isRetryable: error.isRetryable } : null,
      },
    })
  } catch (error) {
    console.error('Failed to re-authorize bottle service tab:', error)
    return NextResponse.json({ error: 'Failed to re-authorize bottle service tab' }, { status: 500 })
  }
})
