import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

// POST - Check if tab needs auto-increment and fire IncrementalAuth if so
// Called after adding items to a tab. Fires silently in the background.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId } = body

    // Get order with cards and settings
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        location: { select: { id: true, settings: true } },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const settings = parseSettings(order.location.settings)
    const {
      autoIncrementEnabled,
      incrementThresholdPercent,
      incrementAmount,
      maxTabAlertAmount,
    } = settings.payments

    // Auto-increment disabled
    if (!autoIncrementEnabled) {
      return NextResponse.json({ data: { action: 'disabled', incremented: false } })
    }

    // No cards on tab
    const defaultCard = order.cards.find((c) => c.isDefault) || order.cards[0]
    if (!defaultCard) {
      return NextResponse.json({ data: { action: 'no_card', incremented: false } })
    }

    // Calculate total authorized across all cards
    const totalAuthorized = order.cards.reduce(
      (sum, card) => sum + Number(card.authAmount),
      0
    )

    // Calculate current tab total (subtotal before tips/tax)
    const tabTotal = Number(order.subtotal)
    const thresholdAmount = totalAuthorized * (incrementThresholdPercent / 100)

    // Not at threshold yet
    if (tabTotal < thresholdAmount) {
      return NextResponse.json({
        data: {
          action: 'below_threshold',
          incremented: false,
          tabTotal,
          totalAuthorized,
          threshold: thresholdAmount,
        },
      })
    }

    // Check max tab alert
    const needsManagerAlert = tabTotal >= maxTabAlertAmount

    // Fire IncrementalAuth against default card
    const locationId = order.locationId

    try {
      await validateReader(defaultCard.readerId, locationId)
      const client = await requireDatacapClient(locationId)

      const response = await client.incrementalAuth(defaultCard.readerId, {
        recordNo: defaultCard.recordNo,
        additionalAmount: incrementAmount,
      })

      const error = parseError(response)
      const approved = response.cmdStatus === 'Approved'

      if (approved) {
        // Update card's authorized amount
        const newAuthAmount = Number(defaultCard.authAmount) + incrementAmount
        await db.orderCard.update({
          where: { id: defaultCard.id },
          data: { authAmount: newAuthAmount },
        })

        console.log(`[Tab Auto-Increment] APPROVED Order=${orderId} Card=...${defaultCard.cardLast4} +$${incrementAmount} NewAuth=$${newAuthAmount} Employee=${employeeId || 'system'}`)

        return NextResponse.json({
          data: {
            action: 'incremented',
            incremented: true,
            additionalAmount: incrementAmount,
            newAuthorizedTotal: newAuthAmount,
            needsManagerAlert,
            tabTotal,
          },
        })
      } else {
        // Increment failed — log warning but don't block
        console.warn(`[Tab Auto-Increment] DECLINED Order=${orderId} Card=...${defaultCard.cardLast4} +$${incrementAmount} Error=${error?.text || 'Unknown'}`)

        return NextResponse.json({
          data: {
            action: 'increment_failed',
            incremented: false,
            tabTotal,
            totalAuthorized,
            needsManagerAlert,
            error: error
              ? { code: error.code, message: error.text, isRetryable: error.isRetryable }
              : null,
          },
        })
      }
    } catch (err) {
      console.warn(`[Tab Auto-Increment] Error:`, err)
      return NextResponse.json({
        data: {
          action: 'error',
          incremented: false,
          needsManagerAlert,
          error: err instanceof Error ? err.message : 'Increment failed',
        },
      })
    }
  } catch (error) {
    console.error('Failed to auto-increment:', error)
    return NextResponse.json({ error: 'Failed to auto-increment' }, { status: 500 })
  }
}
