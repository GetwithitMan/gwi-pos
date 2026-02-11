import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'

// POST - Close tab by capturing against cards
// Supports: device tip, receipt tip (PrintBlankLine), or tip already included
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const {
      employeeId,
      tipMode = 'receipt', // 'device' | 'receipt' | 'included'
      tipAmount,           // Pre-set tip amount (for 'included' mode)
    } = body

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
    }

    // Get order with cards
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        items: {
          where: { deletedAt: null, status: 'active' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.cards.length === 0) {
      return NextResponse.json({ error: 'No authorized cards on this tab' }, { status: 400 })
    }

    const locationId = order.locationId

    // Load tip percentages from location settings
    const location = await db.location.findFirst({ where: { id: locationId }, select: { settings: true } })
    const locSettings = parseSettings(location?.settings)
    const rawSuggestions = locSettings.tipBank?.tipGuide?.percentages ?? [15, 18, 20, 25]
    const tipSuggestions = rawSuggestions
      .map(Number)
      .filter(pct => Number.isFinite(pct) && pct > 0 && pct <= 100)
      .slice(0, 4)
    if (tipSuggestions.length === 0) tipSuggestions.push(15, 18, 20, 25)

    // Calculate purchase amount from order total
    const purchaseAmount = Number(order.total) - Number(order.tipTotal)
    const gratuityAmount = tipMode === 'included' && tipAmount != null ? Number(tipAmount) : undefined

    // Try capturing against default card first, then others
    let capturedCard = null
    let captureResult = null

    for (const card of order.cards) {
      try {
        await validateReader(card.readerId, locationId)
        const client = await requireDatacapClient(locationId)

        // If device tip mode, fire GetSuggestiveTip first
        if (tipMode === 'device') {
          try {
            const tipResponse = await client.getSuggestiveTip(card.readerId, tipSuggestions)
            if (tipResponse.gratuityAmount) {
              // Use device-selected tip
              const deviceTip = parseFloat(tipResponse.gratuityAmount) || 0
              const response = await client.preAuthCapture(card.readerId, {
                recordNo: card.recordNo,
                purchaseAmount,
                gratuityAmount: deviceTip,
              })
              captureResult = { response, tipAmount: deviceTip }
              capturedCard = card
              break
            }
          } catch (tipErr) {
            console.warn(`[Tab Close] Device tip prompt failed, falling back:`, tipErr)
          }
        }

        // Standard capture (receipt tip or included tip)
        const response = await client.preAuthCapture(card.readerId, {
          recordNo: card.recordNo,
          purchaseAmount,
          gratuityAmount,
        })

        captureResult = { response, tipAmount: gratuityAmount || 0 }
        capturedCard = card
        break
      } catch (err) {
        console.warn(`[Tab Close] Capture failed for card ${card.cardLast4}:`, err)
        continue
      }
    }

    if (!capturedCard || !captureResult) {
      return NextResponse.json({
        data: {
          success: false,
          error: 'All cards failed to capture',
        },
      })
    }

    const { response } = captureResult
    const approved = response.cmdStatus === 'Approved'
    const error = parseError(response)

    if (!approved) {
      console.log(`[Tab Close] DECLINED Order=${orderId} Card=${capturedCard.cardType} ...${capturedCard.cardLast4}`)
      return NextResponse.json({
        data: {
          success: false,
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          error: error
            ? { code: error.code, message: error.text, isRetryable: error.isRetryable }
            : { code: 'DECLINED', message: 'Capture declined', isRetryable: true },
        },
      })
    }

    // Update OrderCard + Order status
    const now = new Date()
    await db.$transaction([
      db.orderCard.update({
        where: { id: capturedCard.id },
        data: {
          status: 'captured',
          capturedAmount: purchaseAmount + (captureResult.tipAmount || 0),
          capturedAt: now,
          tipAmount: captureResult.tipAmount || 0,
        },
      }),
      db.order.update({
        where: { id: orderId },
        data: {
          status: 'paid',
          tabStatus: 'closed',
          paidAt: now,
          closedAt: now,
          tipTotal: captureResult.tipAmount || Number(order.tipTotal),
          total: purchaseAmount + (captureResult.tipAmount || 0),
        },
      }),
      // Void any remaining authorized cards
      ...order.cards
        .filter((c) => c.id !== capturedCard!.id && c.status === 'authorized')
        .map((c) =>
          db.orderCard.update({
            where: { id: c.id },
            data: { status: 'voided' },
          })
        ),
    ])

    console.log(`[Tab Close] CAPTURED Order=${orderId} Card=${capturedCard.cardType} ...${capturedCard.cardLast4} Amount=$${purchaseAmount} Tip=$${captureResult.tipAmount || 0} TipMode=${tipMode}`)

    // Dispatch open orders changed so all terminals refresh (fire-and-forget)
    dispatchOpenOrdersChanged(locationId, { trigger: 'paid', orderId }, { async: true }).catch(() => {})
    dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})

    return NextResponse.json({
      data: {
        success: true,
        captured: {
          cardType: capturedCard.cardType,
          cardLast4: capturedCard.cardLast4,
          purchaseAmount,
          tipAmount: captureResult.tipAmount || 0,
          totalAmount: purchaseAmount + (captureResult.tipAmount || 0),
          authCode: response.authCode,
        },
        tipMode,
        // For receipt tip mode: bartender enters tip later via /api/datacap/adjust
        pendingTipAdjust: tipMode === 'receipt',
        recordNo: capturedCard.recordNo,
      },
    })
  } catch (error) {
    console.error('Failed to close tab:', error)
    return NextResponse.json({ error: 'Failed to close tab' }, { status: 500 })
  }
}
