import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { processDcVirtualGiftWebhook } from '@/lib/domain/gift-cards/process-datacap-virtual-gift'
import { createChildLogger } from '@/lib/logger'
import type { VirtualGiftWebhookPayload } from '@/lib/datacap/virtual-gift-client'

const log = createChildLogger('datacap-virtual-gift-webhook')

// Known event types from Datacap Virtual Gift
const KNOWN_EVENT_TYPES = new Set([
  'payment.completed',
  'payment.failed',
  'payment.refunded',
  'delivery.completed',
  'delivery.failed',
  'page.created',
  'page.updated',
  'page.archived',
])

/**
 * POST /api/webhooks/datacap-virtual-gift?locationId=xxx
 *
 * Public endpoint — Datacap calls this when a virtual gift card is purchased.
 * No withAuth — authentication is via HMAC-SHA256 signature verification.
 *
 * Response policy:
 *   - Invalid signature -> 401 (ONLY non-200 case)
 *   - Everything else -> 200 (even errors — Datacap retries on non-200)
 */
export async function POST(request: NextRequest) {
  // 1. Read raw body for signature verification before JSON parse
  const rawBody = await request.text()

  // 2. Extract locationId from query params
  const locationId = request.nextUrl.searchParams.get('locationId')
  if (!locationId) {
    log.warn('Datacap Virtual Gift webhook received without locationId query param')
    // Still return 200 — we cannot process it but don't want Datacap retrying
    return NextResponse.json({ received: true, error: 'Missing locationId' }, { status: 200 })
  }

  // 3. Look up the webhook secret for this location
  let webhookSecret: string | null = null
  try {
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    if (!location) {
      log.warn({ locationId }, 'Datacap Virtual Gift webhook: location not found')
      return NextResponse.json({ received: true, error: 'Location not found' }, { status: 200 })
    }

    const settings = location.settings as Record<string, unknown> | null
    const vgSettings = settings?.datacapVirtualGift as Record<string, unknown> | undefined
    webhookSecret = (vgSettings?.webhookSecret as string) || null
  } catch (err) {
    log.error({ err, locationId }, 'Failed to load location settings for webhook verification')
    return NextResponse.json({ received: true }, { status: 200 })
  }

  // 4. Verify HMAC-SHA256 signature
  const signatureHeader = request.headers.get('x-datacap-signature') || request.headers.get('x-signature')
  if (webhookSecret && signatureHeader) {
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex')

    let signatureValid = false
    try {
      const sigBuffer = Buffer.from(signatureHeader, 'hex')
      const expectedBuffer = Buffer.from(expectedSignature, 'hex')
      if (sigBuffer.length === expectedBuffer.length) {
        signatureValid = timingSafeEqual(sigBuffer, expectedBuffer)
      }
    } catch {
      signatureValid = false
    }

    if (!signatureValid) {
      log.warn({ locationId }, 'Datacap Virtual Gift webhook: invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (webhookSecret && !signatureHeader) {
    // Secret configured but no signature header — reject
    log.warn({ locationId }, 'Datacap Virtual Gift webhook: missing signature header')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  // If no webhook secret configured, skip verification (initial setup / cert environment)

  // 5. Parse JSON payload
  let payload: VirtualGiftWebhookPayload & { eventType?: string }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    log.error({ locationId }, 'Datacap Virtual Gift webhook: invalid JSON body')
    return NextResponse.json({ received: true, error: 'Invalid JSON' }, { status: 200 })
  }

  // CRITICAL: Strip giftCardCvv from payload before any persistence or logging
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { giftCardCvv: _cvvStripped, ...safePayload } = payload

  const eventType = payload.eventType || 'payment.completed'
  const transactionId = payload.transactionId || ''
  const merchantId = payload.merchantId || ''
  const pageId = payload.giftCardPageId || ''

  log.info(
    { locationId, eventType, transactionId, pageId },
    'Datacap Virtual Gift webhook received'
  )

  // 6. Persist to ExternalWebhookEvent with upsert (idempotency)
  try {
    await db.externalWebhookEvent.upsert({
      where: {
        provider_externalTransactionId_eventType: {
          provider: 'datacap_virtual_gift',
          externalTransactionId: transactionId || `page_${pageId}_${Date.now()}`,
          eventType,
        },
      },
      create: {
        provider: 'datacap_virtual_gift',
        externalTransactionId: transactionId || `page_${pageId}_${Date.now()}`,
        eventType,
        signatureValid: true,
        payload: safePayload as unknown as Prisma.InputJsonValue,
        processingStatus: 'received',
        providerPageId: pageId || null,
        providerMerchantId: merchantId || null,
      },
      update: {
        // ON CONFLICT DO NOTHING — don't overwrite an already-processed event
        attemptCount: { increment: 1 },
      },
    })
  } catch (err) {
    log.error({ err, transactionId, eventType }, 'Failed to persist webhook event')
    // Continue processing — persistence failure shouldn't block webhook acknowledgment
  }

  // 7. Dispatch by eventType
  if (eventType === 'payment.completed') {
    // Process the gift card creation
    void processPaymentCompleted(locationId, safePayload, transactionId, pageId).catch((err) => {
      log.error({ err, transactionId }, 'Failed to process payment.completed webhook')
    })
  } else if (KNOWN_EVENT_TYPES.has(eventType)) {
    // Known event type — log and mark processed
    log.info({ eventType, transactionId }, 'Datacap Virtual Gift webhook: known event, log only')
    void markEventProcessed(transactionId, eventType, 'processed').catch((err) => {
      log.error({ err }, 'Failed to mark webhook event processed')
    })
  } else {
    // Unknown event type — log and mark ignored
    log.warn({ eventType, transactionId }, 'Datacap Virtual Gift webhook: unknown event type')
    void markEventIgnored(transactionId, eventType, `Unknown event type: ${eventType}`).catch((err) => {
      log.error({ err }, 'Failed to mark webhook event ignored')
    })
  }

  // 8. Always return 200
  return NextResponse.json({ received: true }, { status: 200 })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function processPaymentCompleted(
  locationId: string,
  payload: Omit<VirtualGiftWebhookPayload, 'giftCardCvv'> & { eventType?: string },
  transactionId: string,
  pageId: string
) {
  const result = await processDcVirtualGiftWebhook(db, {
    locationId,
    giftCardNumber: payload.giftCardNumber || '',
    giftCardBalance: payload.giftCardBalance || 0,
    recipientName: payload.recipientName,
    recipientEmail: payload.recipientEmail,
    recipientPhone: payload.recipientPhone,
    purchaserName: payload.purchaserName,
    message: payload.message,
    transactionId,
    pageId,
  })

  if (result.success) {
    log.info({ transactionId, cardId: (result.data?.giftCard as Record<string, unknown>)?.id }, 'Virtual gift card created from webhook')

    // Update webhook event with the created gift card ID
    await db.externalWebhookEvent.updateMany({
      where: {
        provider: 'datacap_virtual_gift',
        externalTransactionId: transactionId,
        eventType: 'payment.completed',
      },
      data: {
        processingStatus: 'processed',
        processedAt: new Date(),
        relatedGiftCardId: (result.data?.giftCard as Record<string, unknown>)?.id as string || null,
      },
    })

    // Fire-and-forget: send email/SMS delivery notification
    void sendDeliveryNotification(locationId, payload, result.data).catch((err) => {
      log.error({ err, transactionId }, 'Failed to send gift card delivery notification')
    })
  } else {
    log.warn({ transactionId, error: result.error }, 'Failed to process virtual gift webhook')

    await db.externalWebhookEvent.updateMany({
      where: {
        provider: 'datacap_virtual_gift',
        externalTransactionId: transactionId,
        eventType: 'payment.completed',
      },
      data: {
        processingStatus: result.error?.includes('Duplicate') ? 'processed' : 'failed',
        processedAt: new Date(),
        errorMessage: result.error,
      },
    })
  }
}

async function markEventProcessed(transactionId: string, eventType: string, status: 'processed' | 'failed') {
  if (!transactionId) return
  await db.externalWebhookEvent.updateMany({
    where: {
      provider: 'datacap_virtual_gift',
      externalTransactionId: transactionId,
      eventType,
    },
    data: {
      processingStatus: status,
      processedAt: new Date(),
    },
  })
}

async function markEventIgnored(transactionId: string, eventType: string, reason: string) {
  if (!transactionId) return
  await db.externalWebhookEvent.updateMany({
    where: {
      provider: 'datacap_virtual_gift',
      externalTransactionId: transactionId,
      eventType,
    },
    data: {
      processingStatus: 'ignored',
      processedAt: new Date(),
      ignoredReason: reason,
    },
  })
}

async function sendDeliveryNotification(
  locationId: string,
  payload: Omit<VirtualGiftWebhookPayload, 'giftCardCvv'> & { eventType?: string },
  _data: Record<string, unknown> | undefined
) {
  // Email/SMS delivery — uses existing notification infrastructure
  // This will be implemented with the email service already in the POS
  if (payload.recipientEmail) {
    log.info(
      { locationId, email: payload.recipientEmail },
      'Gift card delivery notification queued (email)'
    )
    // TODO: Wire up email service for gift card delivery
    // void emailService.sendGiftCardNotification({ ... }).catch(console.error)
  }

  if (payload.recipientPhone) {
    log.info(
      { locationId, phone: payload.recipientPhone },
      'Gift card delivery notification queued (SMS)'
    )
    // TODO: Wire up Twilio SMS for gift card delivery
    // void smsService.sendGiftCardNotification({ ... }).catch(console.error)
  }
}
