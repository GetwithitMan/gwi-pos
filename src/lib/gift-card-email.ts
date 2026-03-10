/**
 * Gift Card Email Delivery
 *
 * Sends a styled HTML email to gift card recipients when a gift card is purchased
 * with a recipientEmail. Uses the shared email service (Resend API).
 *
 * IMPORTANT: This is called fire-and-forget — never block gift card creation on email delivery.
 */

import { sendEmail } from '@/lib/email-service'

interface GiftCardEmailParams {
  recipientEmail: string
  recipientName?: string
  cardCode: string
  balance: number
  fromName?: string
  message?: string
  locationName: string
  locationAddress?: string
}

/**
 * Send a gift card delivery email to the recipient.
 *
 * @param params - Gift card details for the email
 * @returns Promise that resolves when the email is sent (or fails silently in dev)
 */
export async function sendGiftCardEmail(params: GiftCardEmailParams): Promise<void> {
  const {
    recipientEmail,
    recipientName,
    cardCode,
    balance,
    fromName,
    message,
    locationName,
    locationAddress,
  } = params

  const formattedBalance = `$${balance.toFixed(2)}`
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,'
  const fromLine = fromName ? `from <strong>${escapeHtml(fromName)}</strong>` : ''

  const subject = `You've received a gift card from ${locationName}!`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f5f5f5;">
  <div style="max-width: 520px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 28px; text-align: center;">
      <div style="font-size: 40px; margin-bottom: 8px;">&#127873;</div>
      <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">
        You've received a gift card!
      </h1>
      <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">
        ${fromLine ? `A gift ${fromLine}` : `From ${escapeHtml(locationName)}`}
      </p>
    </div>

    <!-- Body -->
    <div style="padding: 28px;">
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
        ${escapeHtml(greeting)}
      </p>

      ${message ? `
      <div style="padding: 14px 18px; background: #f9fafb; border-left: 3px solid #8b5cf6; border-radius: 6px; margin-bottom: 20px;">
        <p style="color: #4b5563; font-size: 14px; font-style: italic; line-height: 1.5; margin: 0;">
          "${escapeHtml(message)}"
        </p>
      </div>
      ` : ''}

      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        You have a gift card to <strong>${escapeHtml(locationName)}</strong>. Present the code below when you visit to redeem your balance.
      </p>

      <!-- Gift Card Code -->
      <div style="text-align: center; padding: 24px; background: #faf5ff; border: 2px dashed #c4b5fd; border-radius: 12px; margin-bottom: 24px;">
        <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px; font-weight: 600;">
          Gift Card Code
        </p>
        <p style="color: #6366f1; font-size: 28px; font-weight: 800; font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace; letter-spacing: 3px; margin: 0 0 12px;">
          ${escapeHtml(cardCode)}
        </p>
        <p style="color: #6b7280; font-size: 12px; margin: 0 0 4px;">Balance</p>
        <p style="color: #059669; font-size: 32px; font-weight: 800; margin: 0;">
          ${formattedBalance}
        </p>
      </div>

      <!-- Redemption Instructions -->
      <div style="background: #f0fdf4; border-radius: 8px; padding: 16px 18px; margin-bottom: 16px;">
        <p style="color: #166534; font-size: 13px; font-weight: 600; margin: 0 0 8px;">How to redeem:</p>
        <ol style="color: #374151; font-size: 13px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>Visit ${escapeHtml(locationName)}</li>
          <li>Tell your server or cashier you'd like to pay with a gift card</li>
          <li>Provide the code above</li>
        </ol>
      </div>

      ${locationAddress ? `
      <p style="color: #6b7280; font-size: 12px; margin: 0; text-align: center;">
        ${escapeHtml(locationAddress)}
      </p>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="padding: 16px 28px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="color: #9ca3af; font-size: 11px; margin: 0; line-height: 1.6;">
        This gift card was purchased at ${escapeHtml(locationName)}.<br>
        Keep this email for your records. Gift cards are non-refundable.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim()

  const result = await sendEmail({
    to: recipientEmail,
    subject,
    html,
  })

  if (!result.success) {
    console.error(`[GiftCard Email] Failed to send to ${recipientEmail}:`, result.error)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}
