/**
 * Reservation Notification Engine
 *
 * Sends SMS (Twilio) and email (Resend) notifications for reservation events.
 * Renders templates from settings, logs every delivery attempt as ReservationEvent.
 */

import crypto from 'crypto'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email-service'
import type { PrismaClient } from '@prisma/client'

// ============================================
// Types
// ============================================

export type NotificationChannel = 'sms' | 'email'
export type DeliveryStatus = 'sent' | 'failed_delivery' | 'skipped_no_channel' | 'skipped_opt_out'

export type TemplateKey =
  | 'confirmation'
  | 'reminder24h'
  | 'reminder2h'
  | 'cancellation'
  | 'depositRequest'
  | 'depositReceived'
  | 'refundIssued'
  | 'thankYou'
  | 'slotFreed'
  | 'customManual'
  | 'modification'
  | 'noShow'
  | 'waitlistPromoted'

interface NotificationResult {
  channel: NotificationChannel
  status: DeliveryStatus
  providerMessageId?: string
  error?: string
}

interface SendNotificationParams {
  reservation: any       // Prisma Reservation with relations
  templateKey: TemplateKey
  db: PrismaClient
  templates: any         // ReservationMessageTemplates from settings
  venueInfo: {
    name: string
    phone?: string
    address?: string
    email?: string
    slug: string
    baseUrl: string      // e.g., "https://thepasspos.com"
  }
  customMessage?: string  // for customManual template override
  channels?: NotificationChannel[]  // override default channel selection
}

// ============================================
// Opt-in / channel rules
// ============================================

// Which templates require smsOptIn to send SMS (otherwise always send)
const SMS_OPT_IN_REQUIRED: Set<TemplateKey> = new Set([
  'reminder24h',
  'reminder2h',
  'thankYou',
  'slotFreed',
  'waitlistPromoted',
])

// Templates that are SMS-only (no email channel)
const SMS_ONLY: Set<TemplateKey> = new Set([
  'slotFreed',
])

// Event type mapping for audit trail
const EVENT_TYPE_MAP: Partial<Record<TemplateKey, string>> = {
  confirmation: 'confirmation_sent',
  reminder24h: 'reminder_24h_sent',
  reminder2h: 'reminder_2h_sent',
  cancellation: 'cancellation_sent',
  thankYou: 'thank_you_sent',
  customManual: 'custom_message_sent',
  waitlistPromoted: 'waitlist_promoted_sent',
  noShow: 'no_show_sent',
  modification: 'modification_sent',
}

function getEventType(templateKey: TemplateKey): string {
  return EVENT_TYPE_MAP[templateKey] || `${templateKey}_sent`
}

// ============================================
// Template rendering
// ============================================

/**
 * Replace all {{placeholder}} tokens with values from data.
 * Unknown placeholders are replaced with empty string.
 * Null/undefined values become empty string.
 */
export function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = data[key]
    return value != null ? value : ''
  })
}

/**
 * Validate that all placeholders in a template are in the allowed list.
 */
export function validateTemplate(
  template: string,
  allowedPlaceholders: string[]
): { valid: boolean; unknownTokens: string[] } {
  const tokens: string[] = []
  const regex = /\{\{(\w+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(template)) !== null) {
    tokens.push(match[1])
  }

  const allowedSet = new Set(allowedPlaceholders)
  const unknownTokens = tokens.filter((t) => !allowedSet.has(t))

  return {
    valid: unknownTokens.length === 0,
    unknownTokens: [...new Set(unknownTokens)],
  }
}

/**
 * Build the full placeholder data object from reservation + venue info.
 */
export function buildTemplateData(params: {
  reservation: any
  venueInfo: {
    name: string
    phone?: string
    address?: string
    email?: string
    slug: string
    baseUrl: string
  }
  depositAmount?: number
  refundAmount?: number
}): Record<string, string> {
  const { reservation, venueInfo, depositAmount, refundAmount } = params

  // Format date for display
  const dateObj = reservation.reservationDate
    ? new Date(reservation.reservationDate)
    : null
  const formattedDate = dateObj
    ? dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''

  // Format time for display (HH:MM → human readable)
  let formattedTime = reservation.reservationTime || ''
  if (formattedTime && formattedTime.includes(':')) {
    const [h, m] = formattedTime.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour12 = h % 12 || 12
    formattedTime = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const manageToken = reservation.manageToken || ''
  const baseUrl = venueInfo.baseUrl

  // Build manage/confirm/payment URLs
  const manageUrl = manageToken ? `${baseUrl}/reserve/manage/${manageToken}` : ''
  const confirmUrl = manageToken ? `${baseUrl}/reserve/manage/${manageToken}?action=confirm` : ''
  const paymentUrl = reservation.depositToken
    ? `${baseUrl}/reserve/pay-deposit/${reservation.depositToken}`
    : ''
  const bookingUrl = `${baseUrl}/reserve/${venueInfo.slug}`
  const unsubscribeUrl = manageToken
    ? `${baseUrl}/reserve/manage/${manageToken}?action=unsubscribe`
    : ''

  const formatCurrency = (amount: number | undefined | null): string => {
    if (amount == null) return ''
    return `$${amount.toFixed(2)}`
  }

  return {
    // Guest info
    guestName: reservation.guestName || '',
    partySize: String(reservation.partySize || ''),
    specialRequests: reservation.specialRequests || '',
    occasion: reservation.occasion || '',
    confirmationCode: reservation.confirmationCode || reservation.id?.slice(0, 8)?.toUpperCase() || '',

    // Date/time
    date: formattedDate,
    time: formattedTime,

    // Venue info
    venueName: venueInfo.name || '',
    venuePhone: venueInfo.phone || '',
    venueAddress: venueInfo.address || '',
    venueEmail: venueInfo.email || '',

    // Table
    tableName: reservation.table?.name || reservation.tableName || '',

    // URLs — support both naming conventions (manageUrl + manageLink)
    manageUrl,
    manageLink: manageUrl,
    confirmUrl,
    paymentUrl,
    depositLink: paymentUrl,
    bookingLink: bookingUrl,
    claimUrl: confirmUrl,
    unsubscribeUrl,

    // Amounts
    depositAmount: formatCurrency(depositAmount ?? reservation.depositAmount),
    refundAmount: formatCurrency(refundAmount),
    depositExpirationMinutes: String(reservation.depositExpirationMinutes || 60),
    holdMinutes: String(reservation.holdMinutes || 15),

    // Policy
    cancellationPolicy: reservation.cancellationPolicy || '',
  }
}

// ============================================
// Core send function
// ============================================

/**
 * Send reservation notification via SMS and/or email.
 * Determines channels based on template rules + opt-in status.
 * Logs every attempt as a ReservationEvent for audit.
 */
export async function sendReservationNotification(
  params: SendNotificationParams
): Promise<NotificationResult[]> {
  const {
    reservation,
    templateKey,
    db,
    templates,
    venueInfo,
    customMessage,
    channels: channelOverride,
  } = params

  const results: NotificationResult[] = []

  // Resolve which template to use
  const template = templates?.[templateKey]
  if (!template && templateKey !== 'customManual') {
    // No template configured for this key — skip
    return results
  }

  // Build placeholder data
  const data = buildTemplateData({
    reservation,
    venueInfo,
    depositAmount: reservation.depositAmount,
  })

  // Determine which channels to attempt
  const channelsToSend: NotificationChannel[] = channelOverride
    ? [...channelOverride]
    : determineChannels(templateKey)

  for (const channel of channelsToSend) {
    const result = await sendOnChannel({
      channel,
      templateKey,
      template,
      data,
      reservation,
      venueInfo,
      customMessage,
    })

    results.push(result)

    // Log audit event
    const renderedBody =
      channel === 'sms'
        ? renderTemplate(
            customMessage || template?.smsBody || '',
            data
          )
        : renderTemplate(
            customMessage || template?.emailBody || '',
            data
          )

    const templateContent = channel === 'sms' ? template?.smsBody : template?.emailBody
    const templateHash = templateContent
      ? crypto.createHash('md5').update(templateContent).digest('hex').slice(0, 8)
      : ''

    void db.reservationEvent
      .create({
        data: {
          locationId: reservation.locationId,
          reservationId: reservation.id,
          eventType: getEventType(templateKey),
          actor: 'system',
          details: {
            channel,
            status: result.status,
            providerMessageId: result.providerMessageId || null,
            error: result.error || null,
            renderedBody: renderedBody.slice(0, 500),
            templateKey,
            templateHash,
          },
        },
      })
      .catch((err: unknown) => {
        console.error('[Notifications] Failed to log ReservationEvent:', err)
      })
  }

  return results
}

// ============================================
// Internal helpers
// ============================================

function determineChannels(templateKey: TemplateKey): NotificationChannel[] {
  if (SMS_ONLY.has(templateKey)) {
    return ['sms']
  }
  return ['sms', 'email']
}

async function sendOnChannel(params: {
  channel: NotificationChannel
  templateKey: TemplateKey
  template: any
  data: Record<string, string>
  reservation: any
  venueInfo: { name: string; email?: string; slug: string }
  customMessage?: string
}): Promise<NotificationResult> {
  const { channel, templateKey, template, data, reservation, venueInfo, customMessage } = params

  if (channel === 'sms') {
    return sendViaSMS({ templateKey, template, data, reservation, customMessage })
  }

  return sendViaEmail({
    templateKey,
    template,
    data,
    reservation,
    venueInfo,
    customMessage,
  })
}

async function sendViaSMS(params: {
  templateKey: TemplateKey
  template: any
  data: Record<string, string>
  reservation: any
  customMessage?: string
}): Promise<NotificationResult> {
  const { templateKey, template, data, reservation, customMessage } = params

  // Check if guest has a phone number
  const phone = reservation.guestPhone || reservation.customer?.phone
  if (!phone) {
    return { channel: 'sms', status: 'skipped_no_channel' }
  }

  // Check opt-in for sensitive templates
  if (SMS_OPT_IN_REQUIRED.has(templateKey) && !reservation.smsOptInSnapshot) {
    return { channel: 'sms', status: 'skipped_opt_out' }
  }

  // Render the message body
  const rawBody = customMessage || template?.smsBody
  if (!rawBody) {
    return { channel: 'sms', status: 'skipped_no_channel' }
  }

  const body = renderTemplate(rawBody, data)

  try {
    const result = await sendSMS({ to: phone, body })

    if (result.success) {
      return {
        channel: 'sms',
        status: 'sent',
        providerMessageId: result.messageSid,
      }
    }

    return {
      channel: 'sms',
      status: 'failed_delivery',
      error: result.error || 'SMS send failed',
    }
  } catch (err) {
    return {
      channel: 'sms',
      status: 'failed_delivery',
      error: err instanceof Error ? err.message : 'Unknown SMS error',
    }
  }
}

async function sendViaEmail(params: {
  templateKey: TemplateKey
  template: any
  data: Record<string, string>
  reservation: any
  venueInfo: { name: string; email?: string; slug: string }
  customMessage?: string
}): Promise<NotificationResult> {
  const { templateKey, template, data, reservation, venueInfo, customMessage } = params

  // Check if guest has an email address
  const email = reservation.guestEmail || reservation.customer?.email
  if (!email) {
    return { channel: 'email', status: 'skipped_no_channel' }
  }

  // For thankYou, check marketing opt-in
  if (templateKey === 'thankYou' && reservation.customer?.marketingOptIn === false) {
    return { channel: 'email', status: 'skipped_opt_out' }
  }

  // Render subject and body
  const rawSubject = template?.subject || `Notification from ${venueInfo.name}`
  const rawBody = customMessage || template?.emailBody
  if (!rawBody) {
    return { channel: 'email', status: 'skipped_no_channel' }
  }

  const subject = renderTemplate(rawSubject, data)
  let html = renderTemplate(rawBody, data)

  // For thankYou: append CAN-SPAM unsubscribe footer
  if (templateKey === 'thankYou' && data.unsubscribeUrl) {
    html += `<p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">You received this because you dined at ${data.venueName}. <a href="${data.unsubscribeUrl}" style="color:#999;">Unsubscribe</a></p>`
  }

  // Build from address
  const from = venueInfo.email
    ? `${venueInfo.name} <${venueInfo.email}>`
    : `${venueInfo.name} <reservations@${venueInfo.slug}.thepasspos.com>`

  try {
    const result = await sendEmail({
      to: email,
      subject,
      html,
      from,
      replyTo: venueInfo.email || undefined,
    })

    if (result.success) {
      return {
        channel: 'email',
        status: 'sent',
        providerMessageId: result.messageId,
      }
    }

    return {
      channel: 'email',
      status: 'failed_delivery',
      error: result.error || 'Email send failed',
    }
  } catch (err) {
    return {
      channel: 'email',
      status: 'failed_delivery',
      error: err instanceof Error ? err.message : 'Unknown email error',
    }
  }
}
