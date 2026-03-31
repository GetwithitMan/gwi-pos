/**
 * SMS Notification Helper
 *
 * Handles notification creation, template rendering, and retry scheduling.
 * SMS sending via existing Twilio client (src/lib/twilio.ts).
 *
 * Usage:
 * ```typescript
 * import { createDeliveryNotification, renderSmsTemplate } from '@/lib/delivery/notifications'
 *
 * // Render a template
 * const msg = renderSmsTemplate('Your order #{orderNumber} is on the way!', { orderNumber: '1234' })
 *
 * // Send a notification
 * await createDeliveryNotification({
 *   locationId, deliveryOrderId, event: 'dispatched',
 *   channel: 'sms', recipient: '+15551234567', messageBody: msg,
 * })
 * ```
 *
 * NOTE: Uses $queryRawUnsafe/$executeRawUnsafe for raw SQL delivery tables
 * (DeliveryNotification, DeliveryOrder). All queries use positional $1/$2 params — safe from injection.
 */

import { db } from '@/lib/db'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('delivery')

// ── Types ───────────────────────────────────────────────────────────────────

export interface SendNotificationParams {
  locationId: string
  deliveryOrderId: string
  event: string  // e.g., 'confirmed', 'dispatched', 'delivered'
  channel: 'sms' | 'push'
  recipient: string  // phone number for SMS
  messageBody: string
}

const MAX_RETRY_ATTEMPTS = 3

// ── Notification Creation + Send ────────────────────────────────────────────

/**
 * Create a notification record and make the first send attempt.
 *
 * 1. Check dedup index (same event+channel+order = skip)
 * 2. INSERT INTO DeliveryNotification
 * 3. INSERT INTO DeliveryNotificationAttempt (attemptNumber: 1, status: 'queued')
 * 4. Attempt send (Twilio stub for v1)
 * 5. Update attempt status to 'sent' or 'failed'
 * 6. If failed and retries remaining: schedule retry (TODO: implement retry worker)
 */
export async function createDeliveryNotification(params: SendNotificationParams): Promise<void> {
  const { locationId, deliveryOrderId, event, channel, recipient, messageBody } = params

  try {
    // 1. Dedup check — skip if same event+channel+order already sent
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT id FROM "DeliveryNotification"
      WHERE "locationId" = $1
        AND "deliveryOrderId" = $2
        AND "event" = $3
        AND "channel" = $4
      LIMIT 1
    `, locationId, deliveryOrderId, event, channel)

    if (existing.length > 0) {
      log.info(`[DeliveryNotification] Dedup: ${event}/${channel} already sent for order ${deliveryOrderId}`)
      return
    }

    // 2. Create notification record
    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryNotification" (
        "id", "locationId", "deliveryOrderId", "event", "channel",
        "recipient", "messageBody", "status", "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4,
        $5, $6, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `, locationId, deliveryOrderId, event, channel, recipient, messageBody)

    if (!inserted.length) {
      log.error('[DeliveryNotification] Failed to insert notification record')
      return
    }

    const notification = inserted[0]

    // 3. Create first attempt
    await db.$executeRawUnsafe(`
      INSERT INTO "DeliveryNotificationAttempt" (
        "id", "notificationId", "attemptNumber", "status", "createdAt"
      )
      VALUES (gen_random_uuid()::text, $1, 1, 'queued', CURRENT_TIMESTAMP)
    `, notification.id)

    // 4. Attempt send via Twilio (SMS) or Firebase (push)
    const sendResult = await attemptSend(channel, recipient, messageBody)

    // 5. Update attempt and notification status
    if (sendResult.success) {
      await db.$executeRawUnsafe(`
        UPDATE "DeliveryNotificationAttempt"
        SET "status" = 'sent', "sentAt" = CURRENT_TIMESTAMP, "providerMessageId" = $2
        WHERE "notificationId" = $1 AND "attemptNumber" = 1
      `, notification.id, sendResult.providerMessageId || null)

      await db.$executeRawUnsafe(`
        UPDATE "DeliveryNotification"
        SET "status" = 'sent', "sentAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1
      `, notification.id)
    } else {
      await db.$executeRawUnsafe(`
        UPDATE "DeliveryNotificationAttempt"
        SET "status" = 'failed', "errorMessage" = $2
        WHERE "notificationId" = $1 AND "attemptNumber" = 1
      `, notification.id, sendResult.error || 'Unknown error')

      // 6. If failed and retries remaining, mark for retry
      // TODO: Wire a retry worker (cron or queue) to pick up 'pending_retry' notifications
      if (MAX_RETRY_ATTEMPTS > 1) {
        await db.$executeRawUnsafe(`
          UPDATE "DeliveryNotification"
          SET "status" = 'pending_retry', "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1
        `, notification.id)
      } else {
        await db.$executeRawUnsafe(`
          UPDATE "DeliveryNotification"
          SET "status" = 'failed', "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1
        `, notification.id)
      }
    }
  } catch (error) {
    log.error({ err: error }, '[DeliveryNotification] Error creating notification:')
    // Don't throw — notification failure should not block the delivery operation
  }
}

// ── Template Rendering ──────────────────────────────────────────────────────

/**
 * Render an SMS template by replacing placeholder variables with actual data.
 *
 * Supported variables:
 *   {orderNumber} — The order number or ID
 *   {venue}       — The venue/restaurant name
 *   {eta}         — Estimated time of arrival (minutes)
 *   {trackingUrl} — Customer tracking page URL
 */
export function renderSmsTemplate(
  template: string,
  data: {
    orderNumber?: string
    venue?: string
    eta?: string
    trackingUrl?: string
  }
): string {
  let result = template
  if (data.orderNumber) result = result.replace(/{orderNumber}/g, data.orderNumber)
  if (data.venue) result = result.replace(/{venue}/g, data.venue)
  if (data.eta) result = result.replace(/{eta}/g, data.eta)
  if (data.trackingUrl) result = result.replace(/{trackingUrl}/g, data.trackingUrl)
  return result
}

// ── Send Implementation ─────────────────────────────────────────────────────

interface SendResult {
  success: boolean
  providerMessageId?: string
  error?: string
}

/**
 * Attempt to send a notification via the appropriate channel.
 *
 * SMS: Uses the shared Twilio client from src/lib/twilio.ts (same credentials
 * as void approval SMS, error alerts, reservation texts, etc.).
 * Push: Stubbed for future Firebase Cloud Messaging integration.
 */
async function attemptSend(
  channel: 'sms' | 'push',
  recipient: string,
  messageBody: string,
): Promise<SendResult> {
  if (channel === 'sms') {
    if (!isTwilioConfigured()) {
      log.warn('[DeliveryNotification] Twilio not configured, skipping SMS')
      return { success: false, error: 'Twilio not configured' }
    }

    try {
      const result = await sendSMS({ to: recipient, body: messageBody })

      if (result.success) {
        return { success: true, providerMessageId: result.messageSid }
      }

      return { success: false, error: result.error || 'Twilio send failed' }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown Twilio error'
      log.error('[DeliveryNotification] Twilio SMS error:', errMsg)
      return { success: false, error: errMsg }
    }
  }

  if (channel === 'push') {
    // TODO: Wire Firebase Cloud Messaging
    log.info(`[DeliveryNotification] Push STUB: Would send to ${recipient}: ${messageBody}`)
    return { success: true, providerMessageId: `stub-push-${Date.now()}` }
  }

  return { success: false, error: `Unsupported channel: ${channel}` }
}
