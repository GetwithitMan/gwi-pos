/**
 * Feedback Request Service
 *
 * Sends SMS and email feedback requests to customers after payment.
 * Fire-and-forget from payment completion flow.
 */

import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email-service'

interface FeedbackRequestParams {
  phone?: string
  email?: string
  orderNumber: string
  locationName: string
  feedbackUrl: string
}

/**
 * Send feedback request via SMS and/or email.
 * Gracefully handles failures — never throws.
 */
export async function sendFeedbackRequest(params: FeedbackRequestParams): Promise<void> {
  const { phone, email, orderNumber, locationName, feedbackUrl } = params

  if (!feedbackUrl) {
    console.warn('[feedback-request] No feedbackUrl configured, skipping')
    return
  }

  const shortUrl = `${feedbackUrl}${feedbackUrl.includes('?') ? '&' : '?'}order=${orderNumber}`

  // Send SMS if phone provided
  if (phone) {
    void sendSMS({
      to: phone,
      body: `Thanks for visiting ${locationName}! We'd love your feedback: ${shortUrl}`,
    }).catch(err => {
      console.error('[feedback-request] SMS failed:', err)
    })
  }

  // Send email if address provided
  if (email) {
    void sendEmail({
      to: email,
      subject: `How was your visit to ${locationName}?`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Thanks for visiting ${locationName}!</h2>
          <p>We'd love to hear about your experience. It only takes a moment.</p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${shortUrl}" style="background: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Leave Feedback
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">Order #${orderNumber}</p>
        </div>
      `,
    }).catch(err => {
      console.error('[feedback-request] Email failed:', err)
    })
  }
}
