import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// POST - Open a bottle service tab (with tier selection + deposit pre-auth)
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { readerId, employeeId, tierId } = body

    if (!readerId || !employeeId || !tierId) {
      return NextResponse.json({ error: 'Missing required fields: readerId, employeeId, tierId' }, { status: 400 })
    }

    // Get order
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true, settings: true } } },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Get tier
    const tier = await db.bottleServiceTier.findFirst({
      where: { id: tierId, locationId: order.locationId, deletedAt: null, isActive: true },
    })

    if (!tier) {
      return NextResponse.json({ error: 'Bottle service tier not found or inactive' }, { status: 404 })
    }

    const locationId = order.locationId
    const depositAmount = Number(tier.depositAmount)

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    // Step 1: Set tab status to pending_auth
    await db.order.update({
      where: { id: orderId },
      data: { tabStatus: 'pending_auth' },
    })

    // Step 2: CollectCardData to read chip
    let cardholderName: string | undefined
    let cardType: string | undefined
    let cardLast4: string | undefined

    try {
      const collectResponse = await client.collectCardData(readerId, {})
      const collectOk = collectResponse.cmdStatus === 'Success' || collectResponse.cmdStatus === 'Approved'
      if (collectOk) {
        cardholderName = collectResponse.cardholderName || undefined
        cardType = collectResponse.cardType || undefined
        cardLast4 = collectResponse.cardLast4 || undefined
      }
    } catch (err) {
      console.warn('[Bottle Service] CollectCardData failed, continuing with PreAuth:', err)
    }

    // Step 3: EMVPreAuth for deposit amount
    const preAuthResponse = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount: depositAmount,
      requestRecordNo: true,
    })

    const preAuthError = parseError(preAuthResponse)
    const approved = preAuthResponse.cmdStatus === 'Approved'

    if (!approved) {
      await db.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'no_card',
          tabName: cardholderName || order.tabName,
        },
      })

      return NextResponse.json({
        data: {
          approved: false,
          tabStatus: 'no_card',
          cardholderName,
          cardType: cardType || preAuthResponse.cardType,
          cardLast4: cardLast4 || preAuthResponse.cardLast4,
          error: preAuthError
            ? { code: preAuthError.code, message: preAuthError.text, isRetryable: preAuthError.isRetryable }
            : { code: 'DECLINED', message: 'Deposit pre-authorization declined', isRetryable: true },
        },
      })
    }

    // Step 4: Approved — set up bottle service tab
    const finalCardholderName = cardholderName || preAuthResponse.cardholderName || undefined
    const finalCardType = cardType || preAuthResponse.cardType || 'unknown'
    const finalCardLast4 = cardLast4 || preAuthResponse.cardLast4 || '????'
    const recordNo = preAuthResponse.recordNo

    if (!recordNo) {
      console.error('[Bottle Service] PreAuth approved but no RecordNo returned')
      return NextResponse.json({ error: 'Pre-auth approved but no RecordNo token received' }, { status: 500 })
    }

    // Create OrderCard + update Order in a transaction
    const [orderCard] = await db.$transaction([
      db.orderCard.create({
        data: {
          locationId,
          orderId,
          readerId,
          recordNo,
          cardType: finalCardType,
          cardLast4: finalCardLast4,
          cardholderName: finalCardholderName,
          authAmount: depositAmount,
          isDefault: true,
          status: 'authorized',
        },
      }),
      db.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'open',
          tabName: finalCardholderName || order.tabName,
          isBottleService: true,
          bottleServiceTierId: tierId,
          bottleServiceDeposit: depositAmount,
          bottleServiceMinSpend: Number(tier.minimumSpend),
          bottleServiceCurrentSpend: Number(order.subtotal) || 0,
          preAuthId: preAuthResponse.authCode,
          preAuthAmount: depositAmount,
          preAuthLast4: finalCardLast4,
          preAuthCardBrand: finalCardType,
          preAuthRecordNo: recordNo,
          preAuthReaderId: readerId,
        },
      }),
    ])

    // Fire-and-forget: emit order event for event-sourced sync
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      isBottleService: true,
      tierId,
      depositAmount,
      minimumSpend: Number(tier.minimumSpend),
      preAuthId: preAuthResponse.authCode,
      cardLast4: finalCardLast4,
      cardType: finalCardType,
      tabName: finalCardholderName || order.tabName,
    })

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderUpdated(order.locationId, {
      orderId,
      changes: ['bottle-service', 'tabStatus'],
    }).catch(() => {})

    return NextResponse.json({
      data: {
        approved: true,
        tabStatus: 'open',
        isBottleService: true,
        tier: {
          id: tier.id,
          name: tier.name,
          color: tier.color,
          depositAmount,
          minimumSpend: Number(tier.minimumSpend),
          autoGratuityPercent: tier.autoGratuityPercent ? Number(tier.autoGratuityPercent) : null,
        },
        cardholderName: finalCardholderName,
        cardType: finalCardType,
        cardLast4: finalCardLast4,
        authAmount: depositAmount,
        recordNo,
        orderCardId: orderCard.id,
      },
    })
  } catch (error) {
    console.error('Failed to open bottle service tab:', error)
    return NextResponse.json({ error: 'Failed to open bottle service tab' }, { status: 500 })
  }
})

// GET - Get bottle service status for an order (spend progress, alerts)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null, isBottleService: true },
      include: {
        location: { select: { settings: true } },
        cards: {
          where: { deletedAt: null },
          orderBy: { isDefault: 'desc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Bottle service order not found' }, { status: 404 })
    }

    const settings = parseSettings(order.location.settings)
    const currentSpend = order.bottleServiceCurrentSpend != null ? Number(order.bottleServiceCurrentSpend) : Number(order.subtotal)
    const depositAmount = Number(order.bottleServiceDeposit) || 0
    const minimumSpend = Number(order.bottleServiceMinSpend) || 0
    const totalAuth = order.cards.reduce((sum, c) => sum + Number(c.authAmount), 0)

    // Calculate spend progress
    const spendProgress = minimumSpend > 0 ? Math.min((currentSpend / minimumSpend) * 100, 100) : 100
    const minimumMet = currentSpend >= minimumSpend
    const remainingToMinimum = Math.max(minimumSpend - currentSpend, 0)

    // Check if re-auth alert is needed (spend approaching deposit amount)
    const reAuthNeeded = settings.payments.bottleServiceReAuthAlertEnabled &&
      depositAmount > 0 && currentSpend >= depositAmount * 0.8

    // Auto-gratuity
    let autoGratuityPercent = settings.payments.bottleServiceAutoGratuityPercent
    if (order.bottleServiceTierId) {
      const tier = await db.bottleServiceTier.findFirst({
        where: { id: order.bottleServiceTierId, deletedAt: null },
      })
      if (tier?.autoGratuityPercent) {
        autoGratuityPercent = Number(tier.autoGratuityPercent)
      }
    }

    return NextResponse.json({
      data: {
        orderId,
        isBottleService: true,
        tierId: order.bottleServiceTierId,
        depositAmount,
        minimumSpend,
        currentSpend,
        spendProgress: Math.round(spendProgress),
        minimumMet,
        remainingToMinimum,
        totalAuthorized: totalAuth,
        reAuthNeeded,
        autoGratuityPercent,
        cards: order.cards.map(c => ({
          id: c.id,
          cardType: c.cardType,
          cardLast4: c.cardLast4,
          authAmount: Number(c.authAmount),
          isDefault: c.isDefault,
          status: c.status,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to get bottle service status:', error)
    return NextResponse.json({ error: 'Failed to get bottle service status' }, { status: 500 })
  }
})
