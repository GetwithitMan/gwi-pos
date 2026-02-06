import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

// POST - Card-first tab open flow
// 1. CollectCardData (reads chip for cardholder name)
// 2. EMVPreAuth for configurable hold amount
// 3. Creates OrderCard record
// 4. Updates order with tab name from chip
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { readerId, employeeId } = body

    if (!readerId || !employeeId) {
      return NextResponse.json({ error: 'Missing required fields: readerId, employeeId' }, { status: 400 })
    }

    // Get the order
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { location: { select: { id: true, settings: true } } },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId
    const settings = parseSettings(order.location.settings)
    const preAuthAmount = settings.payments.defaultPreAuthAmount || 1

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    // Step 1: Set tab status to pending_auth immediately
    await db.order.update({
      where: { id: orderId },
      data: { tabStatus: 'pending_auth' },
    })

    // Step 2: CollectCardData to read chip (cardholder name)
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
      console.warn('[Tab Open] CollectCardData failed, continuing with PreAuth:', err)
    }

    // Step 3: EMVPreAuth for hold amount
    const preAuthResponse = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount: preAuthAmount,
      requestRecordNo: true,
    })

    const preAuthError = parseError(preAuthResponse)
    const approved = preAuthResponse.cmdStatus === 'Approved'

    if (!approved) {
      // Decline — update tab status, don't create OrderCard
      await db.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'no_card',
          tabName: cardholderName || order.tabName,
        },
      })

      console.log(`[Tab Open] DECLINED Order=${orderId} Card=${cardType || 'unknown'} ...${cardLast4 || '????'}`)

      return NextResponse.json({
        data: {
          approved: false,
          tabStatus: 'no_card',
          cardholderName,
          cardType: cardType || preAuthResponse.cardType,
          cardLast4: cardLast4 || preAuthResponse.cardLast4,
          error: preAuthError
            ? { code: preAuthError.code, message: preAuthError.text, isRetryable: preAuthError.isRetryable }
            : { code: 'DECLINED', message: 'Pre-authorization declined', isRetryable: true },
        },
      })
    }

    // Step 4: Card approved — use data from PreAuth response if CollectCardData didn't get it
    const finalCardholderName = cardholderName || preAuthResponse.cardholderName || undefined
    const finalCardType = cardType || preAuthResponse.cardType || 'unknown'
    const finalCardLast4 = cardLast4 || preAuthResponse.cardLast4 || '????'
    const recordNo = preAuthResponse.recordNo

    if (!recordNo) {
      console.error('[Tab Open] PreAuth approved but no RecordNo returned')
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
          authAmount: preAuthAmount,
          isDefault: true,
          status: 'authorized',
        },
      }),
      db.order.update({
        where: { id: orderId },
        data: {
          tabStatus: 'open',
          tabName: finalCardholderName || order.tabName,
          preAuthId: preAuthResponse.authCode,
          preAuthAmount: preAuthAmount,
          preAuthLast4: finalCardLast4,
          preAuthCardBrand: finalCardType,
          preAuthRecordNo: recordNo,
          preAuthReaderId: readerId,
        },
      }),
    ])

    console.log(`[Tab Open] APPROVED Order=${orderId} Card=${finalCardType} ...${finalCardLast4} Name=${finalCardholderName || 'N/A'} Auth=$${preAuthAmount} RecordNo=${recordNo}`)

    return NextResponse.json({
      data: {
        approved: true,
        tabStatus: 'open',
        cardholderName: finalCardholderName,
        cardType: finalCardType,
        cardLast4: finalCardLast4,
        authAmount: preAuthAmount,
        recordNo,
        orderCardId: orderCard.id,
      },
    })
  } catch (error) {
    console.error('Failed to open tab:', error)
    return NextResponse.json({ error: 'Failed to open tab' }, { status: 500 })
  }
}
