/**
 * Marketing Template Engine
 *
 * Variable substitution and message rendering for email/SMS campaigns.
 * CAN-SPAM compliance: every message includes unsubscribe mechanism.
 */

/**
 * Replace {{variable}} placeholders with values from the vars map.
 * Unknown variables are replaced with empty string.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? ''
  })
}

/**
 * Wrap email body in a basic HTML layout with header, body, and CAN-SPAM footer.
 */
export function renderEmailHtml(
  body: string,
  vars: Record<string, string>
): string {
  const renderedBody = renderTemplate(body, vars)
  const locationName = vars.location_name || 'Our Restaurant'
  const unsubscribeUrl = vars.unsubscribe_url || '#'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #1f2937; color: #ffffff; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 600; }
    .body { padding: 24px 24px 32px; color: #1f2937; font-size: 16px; line-height: 1.6; }
    .footer { padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; }
    .footer a { color: #3b82f6; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escapeHtml(locationName)}</h1>
    </div>
    <div class="body">
      ${renderedBody}
    </div>
    <div class="footer">
      <p>You are receiving this because you opted in to marketing from ${escapeHtml(locationName)}.</p>
      <p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> from future emails.</p>
      <p style="margin-top: 8px; font-size: 11px; color: #9ca3af;">
        This email was sent by ${escapeHtml(locationName)}. &copy; ${new Date().getFullYear()}
      </p>
    </div>
  </div>
</body>
</html>`
}

/**
 * Render SMS body with STOP instructions appended (CAN-SPAM / TCPA compliance).
 * Truncates to fit within SMS segment limits.
 */
export function renderSmsBody(
  body: string,
  vars: Record<string, string>
): string {
  const rendered = renderTemplate(body, vars)
  const stopSuffix = '\n\nReply STOP to unsubscribe.'

  // Standard SMS segment = 160 chars. Leave room for STOP instructions.
  const maxBodyLength = 160 - stopSuffix.length
  const trimmed =
    rendered.length > maxBodyLength
      ? rendered.slice(0, maxBodyLength - 3) + '...'
      : rendered

  return trimmed + stopSuffix
}

/**
 * Build template variables for a specific customer and location.
 */
export function buildTemplateVars(
  customer: { firstName: string; lastName: string },
  locationName: string,
  unsubscribeUrl: string
): Record<string, string> {
  return {
    customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
    customer_first_name: customer.firstName,
    customer_last_name: customer.lastName,
    location_name: locationName,
    unsubscribe_url: unsubscribeUrl,
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
