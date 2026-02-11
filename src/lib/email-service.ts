/**
 * Email Service
 *
 * Send emails using Resend API (or fallback to console logging in dev).
 * Used for error alerts, reports, and notifications.
 *
 * Setup:
 * 1. Sign up at resend.com
 * 2. Get API key
 * 3. Add to .env.local:
 *    RESEND_API_KEY=re_...
 *    EMAIL_FROM=alerts@yourdomain.com
 *    EMAIL_TO=admin@yourdomain.com
 *
 * Usage:
 * ```typescript
 * import { sendEmail } from '@/lib/email-service'
 *
 * await sendEmail({
 *   to: 'user@example.com',
 *   subject: 'Order Confirmation',
 *   html: '<h1>Thank you!</h1>',
 * })
 * ```
 */

// ============================================
// Type Definitions
// ============================================

export interface EmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  replyTo?: string
}

export interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
}

// ============================================
// Email Service
// ============================================

/**
 * Send an email using Resend API
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const defaultFrom = process.env.EMAIL_FROM || 'noreply@gwipos.com'

  // Development mode - just log to console
  if (process.env.NODE_ENV === 'development' && !apiKey) {
    return {
      success: true,
      messageId: 'dev-mode-' + Date.now(),
    }
  }

  // Production mode - require API key
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured - cannot send email')
    return {
      success: false,
      error: 'Email service not configured',
    }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: options.from || defaultFrom,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        reply_to: options.replyTo,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Failed to send email:', data)
      return {
        success: false,
        error: data.message || `HTTP ${response.status}`,
      }
    }

    return {
      success: true,
      messageId: data.id,
    }

  } catch (error) {
    console.error('Email send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send error alert email (formatted)
 */
export async function sendErrorAlertEmail(
  severity: string,
  errorType: string,
  message: string,
  details: {
    action?: string
    path?: string
    stackTrace?: string
    orderId?: string
    paymentId?: string
    locationId?: string
    groupId?: string
  }
): Promise<EmailResult> {
  const to = process.env.EMAIL_TO

  if (!to) {
    return {
      success: false,
      error: 'EMAIL_TO not configured',
    }
  }

  const severityColor = getSeverityColor(severity)
  const subject = `[${severity}] ${errorType}: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

        <!-- Header -->
        <div style="background: ${severityColor}; color: white; padding: 24px;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">${severity} Error Detected</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.95; font-size: 16px;">${errorType}</p>
        </div>

        <!-- Content -->
        <div style="padding: 24px;">

          <!-- Error Message -->
          <div style="margin-bottom: 20px;">
            <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #1f2937;">Error Message</h2>
            <p style="margin: 0; padding: 12px; background: #fef2f2; border-left: 4px solid #dc2626; color: #991b1b; border-radius: 4px;">
              ${message}
            </p>
          </div>

          <!-- Details -->
          ${details.action ? `
            <div style="margin-bottom: 16px;">
              <strong style="color: #6b7280;">Action:</strong>
              <span style="color: #1f2937;">${details.action}</span>
            </div>
          ` : ''}

          ${details.path ? `
            <div style="margin-bottom: 16px;">
              <strong style="color: #6b7280;">Path:</strong>
              <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 14px; color: #1f2937;">${details.path}</code>
            </div>
          ` : ''}

          <!-- Business Context -->
          ${details.orderId || details.paymentId ? `
            <div style="margin: 20px 0; padding: 16px; background: #f9fafb; border-radius: 6px;">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #1f2937;">Business Context</h3>
              ${details.orderId ? `
                <div style="margin-bottom: 8px;">
                  <strong style="color: #6b7280;">Order ID:</strong>
                  <span style="color: #1f2937;">${details.orderId}</span>
                </div>
              ` : ''}
              ${details.paymentId ? `
                <div>
                  <strong style="color: #6b7280;">Payment ID:</strong>
                  <span style="color: #1f2937;">${details.paymentId}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}

          <!-- Stack Trace -->
          ${details.stackTrace ? `
            <div style="margin-top: 20px;">
              <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #1f2937;">Stack Trace</h3>
              <pre style="margin: 0; padding: 12px; background: #1f2937; color: #f3f4f6; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.5;">${escapeHtml(details.stackTrace)}</pre>
            </div>
          ` : ''}

        </div>

        <!-- Footer -->
        <div style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #6b7280;">
            <strong>Timestamp:</strong> ${new Date().toLocaleString()}<br>
            ${details.locationId ? `<strong>Location ID:</strong> ${details.locationId}<br>` : ''}
            ${details.groupId ? `<strong>Group ID:</strong> ${details.groupId}<br>` : ''}
          </p>
        </div>

      </div>
    </body>
    </html>
  `

  return sendEmail({
    to,
    subject,
    html,
  })
}

// ============================================
// Helper Functions
// ============================================

function getSeverityColor(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return '#dc2626' // Red 600
    case 'HIGH':
      return '#f97316' // Orange 500
    case 'MEDIUM':
      return '#eab308' // Yellow 500
    case 'LOW':
      return '#3b82f6' // Blue 500
    default:
      return '#6b7280' // Gray 500
  }
}

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
