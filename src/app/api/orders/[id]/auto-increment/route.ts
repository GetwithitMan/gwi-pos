import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { dispatchTabUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// POST - Check if tab needs auto-increment and fire IncrementalAuth if so
// Called after adding items to a tab. Fires silently in the background.
//
// PAYMENT-SAFETY: Idempotency
// No idempotency key is needed for IncrementalAuth. Datacap deduplicates by recordNo
// within a batch window — sending the same increment twice for the same recordNo and amount
// is a no-op on the processor side. The operation is additive (increases hold), not a charge,
// so a double-increment only over-holds (auto-released at batch close).
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId, force } = body  // force=true bypasses threshold (user clicked Re-Auth)

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
      incrementTipBufferPercent,
      maxTabAlertAmount,
    } = settings.payments

    // Auto-increment disabled (unless forced by user)
    if (!autoIncrementEnabled && !force) {
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

    // Calculate current tab total (WITH tax — hold must cover full amount)
    const tabTotal = Number(order.total)
    const thresholdAmount = totalAuthorized * (incrementThresholdPercent / 100)

    // Not at threshold yet (skip check if forced — user explicitly clicked Re-Auth)
    if (!force && tabTotal < thresholdAmount) {
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

    // If tab total is already covered by current auth, nothing to increment
    if (tabTotal <= totalAuthorized && !force) {
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

      // Target hold = total + tip buffer (e.g. 25% to cover potential tip)
      // If buffer is 0, hold targets exact tab total
      const tipBuffer = (incrementTipBufferPercent ?? 25) / 100
      const targetHold = Math.ceil(tabTotal * (1 + tipBuffer) * 100) / 100
      const rawIncrement = Math.max(targetHold - totalAuthorized, 0)
      // Force (Re-Auth): exact amount needed to reach target hold
      // Auto: enforce minimum (e.g. $25) to avoid frequent small auths
      const dynamicIncrement = force
        ? rawIncrement
        : Math.max(rawIncrement, incrementAmount)

      const response = await client.incrementalAuth(defaultCard.readerId, {
        recordNo: defaultCard.recordNo,
        additionalAmount: dynamicIncrement,
      })

      const error = parseError(response)
      const approved = response.cmdStatus === 'Approved'

      if (approved) {
        // Update card's authorized amount AND order's preAuthAmount (for Open Orders display)
        const newAuthAmount = Number(defaultCard.authAmount) + dynamicIncrement
        await db.$transaction([
          db.orderCard.update({
            where: { id: defaultCard.id },
            data: { authAmount: newAuthAmount },
          }),
          db.order.update({
            where: { id: orderId },
            data: { preAuthAmount: newAuthAmount, version: { increment: 1 } },
          }),
        ])

        // Fire-and-forget event emission
        void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
          preAuthAmount: Math.round(newAuthAmount * 100),
        }).catch(console.error)

        // Fire-and-forget socket dispatch for cross-terminal sync
        void dispatchTabUpdated(locationId, {
          orderId,
          status: 'incremented',
        }).catch(() => {})

        return NextResponse.json({
          data: {
            action: 'incremented',
            incremented: true,
            additionalAmount: dynamicIncrement,
            newAuthorizedTotal: newAuthAmount,
            needsManagerAlert,
            tabTotal,
          },
        })
      } else {
        // Increment failed — log warning but don't block
        console.warn(`[Tab Auto-Increment] DECLINED Order=${orderId} Card=...${defaultCard.cardLast4} +$${dynamicIncrement} Error=${error?.text || 'Unknown'}`)

        // Fire-and-forget: notify terminals of increment failure (triggers red badge)
        void dispatchTabUpdated(locationId, {
          orderId,
          status: 'increment_failed',
        }).catch(() => {})

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
      // PAYMENT-SAFETY: Ambiguous state — IncrementalAuth may have succeeded on the processor
      // but we didn't get the response (timeout/network). The card's hold may have increased
      // without our DB reflecting it. This is low-risk: over-holds are released at batch close,
      // and the next auto-increment will recalculate the correct delta from the DB state.
      console.error('[PAYMENT-SAFETY] Ambiguous state', {
        orderId,
        flow: 'auto-increment',
        reason: 'incremental_auth_error_or_timeout',
        datacapRecordNo: defaultCard.recordNo,
        cardLast4: defaultCard.cardLast4,
        attemptedIncrement: force
          ? Math.max(Math.ceil(tabTotal * (1 + ((incrementTipBufferPercent ?? 25) / 100)) * 100) / 100 - totalAuthorized, 0)
          : Math.max(Math.ceil(tabTotal * (1 + ((incrementTipBufferPercent ?? 25) / 100)) * 100) / 100 - totalAuthorized, incrementAmount),
        currentAuthorized: totalAuthorized,
        tabTotal,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
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
})
