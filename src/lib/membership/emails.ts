/**
 * Membership email templates.
 *
 * Each function returns { subject, html, text } for use with sendEmail().
 * Templates use inline styles (email-safe) and include plain text alternatives.
 *
 * Usage:
 *   import { membershipWelcomeEmail } from '@/lib/membership/emails'
 *   import { sendEmail } from '@/lib/email-service'
 *
 *   const email = membershipWelcomeEmail({ ... })
 *   await sendEmail({ to: customer.email, ...email })
 */

// ── Shared Styles ───────────────────────────────────────────────────────────

const BRAND_COLOR = '#2563eb' // Blue 600
const SUCCESS_COLOR = '#16a34a' // Green 600
const WARNING_COLOR = '#d97706' // Amber 600
const DANGER_COLOR = '#dc2626' // Red 600

function wrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
${content}
</div>
</body>
</html>`
}

function header(title: string, subtitle: string, color: string): string {
  return `<div style="background:${color};color:white;padding:24px;">
<h1 style="margin:0;font-size:22px;font-weight:600;">${title}</h1>
<p style="margin:8px 0 0;opacity:0.95;font-size:15px;">${subtitle}</p>
</div>`
}

function row(label: string, value: string): string {
  return `<div style="margin-bottom:12px;">
<strong style="color:#6b7280;font-size:14px;">${label}:</strong>
<span style="color:#1f2937;font-size:14px;margin-left:4px;">${value}</span>
</div>`
}

function footer(locationName?: string): string {
  return `<div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
<p style="margin:0;font-size:12px;color:#9ca3af;">
${locationName ? `${locationName} &middot; ` : ''}Powered by GWI POS<br>
You are receiving this because you have an active membership.
</p>
</div>`
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

// ── 1. Welcome Email ────────────────────────────────────────────────────────

interface WelcomeParams {
  customerName: string
  planName: string
  price: number
  billingCycle: string
  nextBillingDate: Date | string
  benefits?: string[]
  locationName?: string
}

export function membershipWelcomeEmail(params: WelcomeParams) {
  const { customerName, planName, price, billingCycle, nextBillingDate, benefits, locationName } = params
  const subject = `Welcome to ${planName}!`

  const benefitsList = benefits && benefits.length > 0
    ? `<div style="margin:20px 0;padding:16px;background:#f0fdf4;border-radius:6px;">
<h3 style="margin:0 0 8px;font-size:15px;color:#166534;">Your Benefits</h3>
<ul style="margin:0;padding-left:20px;color:#1f2937;font-size:14px;">${benefits.map(b => `<li style="margin-bottom:4px;">${escapeHtml(b)}</li>`).join('')}</ul>
</div>`
    : ''

  const html = wrapper(`
${header('Welcome!', `You're now a ${escapeHtml(planName)} member`, SUCCESS_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">Thank you for joining! Your membership is now active.</p>
<div style="padding:16px;background:#f9fafb;border-radius:6px;margin-bottom:20px;">
${row('Plan', escapeHtml(planName))}
${row('Price', `${formatCurrency(price)} / ${billingCycle}`)}
${row('Next Billing Date', formatDate(nextBillingDate))}
</div>
${benefitsList}
</div>
${footer(locationName)}`)

  const text = `Welcome to ${planName}!

Hi ${customerName},

Thank you for joining! Your membership is now active.

Plan: ${planName}
Price: ${formatCurrency(price)} / ${billingCycle}
Next Billing Date: ${formatDate(nextBillingDate)}
${benefits && benefits.length > 0 ? `\nYour Benefits:\n${benefits.map(b => `- ${b}`).join('\n')}` : ''}`

  return { subject, html, text }
}

// ── 2. Upcoming Charge Email ────────────────────────────────────────────────

interface UpcomingChargeParams {
  customerName: string
  planName: string
  amount: number
  chargeDate: Date | string
  cardLast4: string
  isProrated?: boolean
  locationName?: string
}

export function membershipUpcomingChargeEmail(params: UpcomingChargeParams) {
  const { customerName, planName, amount, chargeDate, cardLast4, isProrated, locationName } = params
  const subject = `Upcoming charge: ${formatCurrency(amount)} on ${formatDate(chargeDate)}`

  const prorationNote = isProrated
    ? `<p style="margin:12px 0 0;font-size:13px;color:#d97706;font-style:italic;">This amount has been prorated based on your plan change.</p>`
    : ''

  const html = wrapper(`
${header('Upcoming Charge', `Your ${escapeHtml(planName)} membership`, BRAND_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">This is a reminder that your membership will be charged in 3 days.</p>
<div style="padding:16px;background:#f9fafb;border-radius:6px;">
${row('Amount', formatCurrency(amount))}
${row('Date', formatDate(chargeDate))}
${row('Card', `ending in ${cardLast4}`)}
${prorationNote}
</div>
</div>
${footer(locationName)}`)

  const text = `Upcoming charge for your ${planName} membership.

Hi ${customerName},

Your membership will be charged in 3 days.

Amount: ${formatCurrency(amount)}
Date: ${formatDate(chargeDate)}
Card: ending in ${cardLast4}${isProrated ? '\n(This amount has been prorated based on your plan change.)' : ''}`

  return { subject, html, text }
}

// ── 3. Charge Success Email ─────────────────────────────────────────────────

interface ChargeSuccessParams {
  customerName: string
  planName: string
  amount: number
  chargeDate: Date | string
  cardLast4: string
  nextBillingDate: Date | string
  refNo?: string
  locationName?: string
}

export function membershipChargeSuccessEmail(params: ChargeSuccessParams) {
  const { customerName, planName, amount, chargeDate, cardLast4, nextBillingDate, refNo, locationName } = params
  const subject = `Payment receipt: ${formatCurrency(amount)} for ${planName}`

  const html = wrapper(`
${header('Payment Received', 'Thank you for your membership!', SUCCESS_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">Your membership payment has been processed successfully.</p>
<div style="padding:16px;background:#f9fafb;border-radius:6px;margin-bottom:20px;">
${row('Amount', formatCurrency(amount))}
${row('Date', formatDate(chargeDate))}
${row('Card', `ending in ${cardLast4}`)}
${refNo ? row('Reference', refNo) : ''}
${row('Next Billing Date', formatDate(nextBillingDate))}
</div>
</div>
${footer(locationName)}`)

  const text = `Payment receipt for ${planName}.

Hi ${customerName},

Your membership payment has been processed.

Amount: ${formatCurrency(amount)}
Date: ${formatDate(chargeDate)}
Card: ending in ${cardLast4}${refNo ? `\nReference: ${refNo}` : ''}
Next Billing Date: ${formatDate(nextBillingDate)}`

  return { subject, html, text }
}

// ── 4. Charge Failed Email ──────────────────────────────────────────────────

interface ChargeFailedParams {
  customerName: string
  planName: string
  amount: number
  declineReason: string
  updateCardUrl?: string
  locationName?: string
}

export function membershipChargeFailedEmail(params: ChargeFailedParams) {
  const { customerName, planName, amount, declineReason, updateCardUrl, locationName } = params
  const subject = `Action required: Payment failed for ${planName}`

  const safeReason = escapeHtml(declineReason)
  const ctaButton = updateCardUrl
    ? `<div style="text-align:center;margin:24px 0;">
<a href="${escapeHtml(updateCardUrl)}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">Update Payment Method</a>
</div>`
    : `<p style="margin:16px 0 0;font-size:14px;color:#374151;">Please contact us to update your payment method.</p>`

  const html = wrapper(`
${header('Payment Failed', 'Action required to keep your membership', DANGER_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">We were unable to process your ${escapeHtml(planName)} membership payment.</p>
<div style="padding:16px;background:#fef2f2;border-left:4px solid ${DANGER_COLOR};border-radius:4px;margin-bottom:20px;">
${row('Amount', formatCurrency(amount))}
${row('Reason', safeReason)}
</div>
${ctaButton}
</div>
${footer(locationName)}`)

  const text = `Payment failed for ${planName}.

Hi ${customerName},

We were unable to process your membership payment of ${formatCurrency(amount)}.

Reason: ${declineReason}

Please update your payment method to continue your membership.${updateCardUrl ? `\n\nUpdate card: ${updateCardUrl}` : ''}`

  return { subject, html, text }
}

// ── 5. Retry Scheduled Email ────────────────────────────────────────────────

interface RetryScheduledParams {
  customerName: string
  planName: string
  retryDate: Date | string
  cardLast4: string
  locationName?: string
}

export function membershipRetryScheduledEmail(params: RetryScheduledParams) {
  const { customerName, planName, retryDate, cardLast4, locationName } = params
  const subject = `We'll retry your ${planName} payment on ${formatDate(retryDate)}`

  const html = wrapper(`
${header('Payment Retry Scheduled', `We'll try again soon`, WARNING_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">Your recent membership payment didn't go through. We'll automatically retry on the date below.</p>
<div style="padding:16px;background:#fffbeb;border-left:4px solid ${WARNING_COLOR};border-radius:4px;">
${row('Retry Date', formatDate(retryDate))}
${row('Card', `ending in ${cardLast4}`)}
</div>
<p style="margin:20px 0 0;font-size:14px;color:#6b7280;">If your card details have changed, please update your payment method before the retry date.</p>
</div>
${footer(locationName)}`)

  const text = `Payment retry scheduled for ${planName}.

Hi ${customerName},

Your recent payment didn't go through. We'll retry on ${formatDate(retryDate)} using your card ending in ${cardLast4}.

If your card details have changed, please update your payment method.`

  return { subject, html, text }
}

// ── 6. Cancelled Email ──────────────────────────────────────────────────────

interface CancelledParams {
  customerName: string
  planName: string
  effectiveDate: Date | string
  accessUntilPeriodEnd: boolean
  locationName?: string
}

export function membershipCancelledEmail(params: CancelledParams) {
  const { customerName, planName, effectiveDate, accessUntilPeriodEnd, locationName } = params
  const subject = `Your ${planName} membership has been cancelled`

  const accessNote = accessUntilPeriodEnd
    ? `<p style="margin:20px 0 0;font-size:14px;color:#374151;padding:12px;background:#f0fdf4;border-radius:6px;">You will continue to have access to your membership benefits until <strong>${formatDate(effectiveDate)}</strong>.</p>`
    : ''

  const html = wrapper(`
${header('Membership Cancelled', escapeHtml(planName), '#6b7280')}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">Your membership has been cancelled as requested.</p>
<div style="padding:16px;background:#f9fafb;border-radius:6px;">
${row('Plan', escapeHtml(planName))}
${row('Effective Date', formatDate(effectiveDate))}
</div>
${accessNote}
<p style="margin:20px 0 0;font-size:14px;color:#6b7280;">We're sorry to see you go. You're welcome to rejoin anytime.</p>
</div>
${footer(locationName)}`)

  const text = `Your ${planName} membership has been cancelled.

Hi ${customerName},

Your membership has been cancelled effective ${formatDate(effectiveDate)}.${accessUntilPeriodEnd ? `\n\nYou will continue to have access until ${formatDate(effectiveDate)}.` : ''}

We're sorry to see you go. You're welcome to rejoin anytime.`

  return { subject, html, text }
}

// ── 7. Card Expiring Email ──────────────────────────────────────────────────

interface CardExpiringParams {
  customerName: string
  planName: string
  cardLast4: string
  expiryMonth: number
  expiryYear: number
  updateCardUrl?: string
  locationName?: string
}

export function membershipCardExpiringEmail(params: CardExpiringParams) {
  const { customerName, planName, cardLast4, expiryMonth, expiryYear, updateCardUrl, locationName } = params
  const expiryStr = `${String(expiryMonth).padStart(2, '0')}/${expiryYear}`
  const subject = `Your card ending in ${cardLast4} is expiring soon`

  const ctaButton = updateCardUrl
    ? `<div style="text-align:center;margin:24px 0;">
<a href="${escapeHtml(updateCardUrl)}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">Update Payment Method</a>
</div>`
    : `<p style="margin:16px 0 0;font-size:14px;color:#374151;">Please contact us to update your payment method.</p>`

  const html = wrapper(`
${header('Card Expiring Soon', 'Update your payment method', WARNING_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#1f2937;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;">The card on file for your ${escapeHtml(planName)} membership is expiring soon. Please update it to avoid any interruption.</p>
<div style="padding:16px;background:#fffbeb;border-left:4px solid ${WARNING_COLOR};border-radius:4px;">
${row('Card', `ending in ${cardLast4}`)}
${row('Expires', expiryStr)}
</div>
${ctaButton}
</div>
${footer(locationName)}`)

  const text = `Your card is expiring soon.

Hi ${customerName},

The card ending in ${cardLast4} (expires ${expiryStr}) on your ${planName} membership is expiring soon.

Please update your payment method to avoid interruption.${updateCardUrl ? `\n\nUpdate card: ${updateCardUrl}` : ''}`

  return { subject, html, text }
}

// ── 8. Admin Decline Summary Email ──────────────────────────────────────────

interface DeclineSummaryItem {
  customerName: string
  planName: string
  declineReason: string
  failedAttempts: number
  lastFailedAt: Date | string
}

interface AdminDeclineSummaryParams {
  declines: DeclineSummaryItem[]
  locationName: string
  reportDate: Date | string
}

export function membershipAdminDeclineSummaryEmail(params: AdminDeclineSummaryParams) {
  const { declines, locationName, reportDate } = params
  const subject = `[${locationName}] ${declines.length} membership decline${declines.length === 1 ? '' : 's'} — ${formatDate(reportDate)}`

  const tableRows = declines.map(d => `<tr>
<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#1f2937;">${escapeHtml(d.customerName)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#1f2937;">${escapeHtml(d.planName)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#dc2626;">${escapeHtml(d.declineReason)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#1f2937;text-align:center;">${d.failedAttempts}</td>
</tr>`).join('')

  const html = wrapper(`
${header('Membership Decline Summary', `${declines.length} persistent decline${declines.length === 1 ? '' : 's'}`, DANGER_COLOR)}
<div style="padding:24px;">
<p style="margin:0 0 20px;font-size:15px;color:#374151;">The following memberships have persistent payment declines that may require manual intervention.</p>
<table style="width:100%;border-collapse:collapse;">
<thead>
<tr style="background:#f9fafb;">
<th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Customer</th>
<th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Plan</th>
<th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Reason</th>
<th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Attempts</th>
</tr>
</thead>
<tbody>${tableRows}</tbody>
</table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Review these in the POS admin under Memberships to retry or reach out to customers.</p>
</div>
${footer(locationName)}`)

  const textRows = declines.map(d =>
    `- ${d.customerName} | ${d.planName} | ${d.declineReason} | ${d.failedAttempts} attempt(s)`
  ).join('\n')

  const text = `Membership Decline Summary — ${locationName}
${declines.length} persistent decline(s) as of ${formatDate(reportDate)}

${textRows}

Review these in the POS admin under Memberships.`

  return { subject, html, text }
}
