import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import crypto from 'crypto'

/**
 * Public unsubscribe endpoint — no auth required.
 * Accessible from email/SMS unsubscribe links.
 *
 * Token format: base64url(customerId:campaignId:hmac16)
 */

// GET - Show unsubscribe confirmation page
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')

    if (!token) {
      return htmlResponse('Invalid Link', 'This unsubscribe link is invalid or has expired.', 400)
    }

    const parsed = parseToken(token)
    if (!parsed) {
      return htmlResponse('Invalid Link', 'This unsubscribe link is invalid or has expired.', 400)
    }

    // Verify customer exists
    const customer = await db.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true, firstName: true, email: true },
    })

    if (!customer) {
      return htmlResponse('Not Found', 'Customer record not found.', 404)
    }

    // Show confirmation page with POST form
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    body { margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 24px; color: #1f2937; margin: 0 0 12px; }
    p { color: #6b7280; font-size: 16px; line-height: 1.5; margin: 0 0 24px; }
    button { background: #dc2626; color: white; border: none; padding: 12px 32px; font-size: 16px; font-weight: 600; border-radius: 8px; cursor: pointer; }
    button:hover { background: #b91c1c; }
    .cancel { display: block; margin-top: 16px; color: #6b7280; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribe from Marketing</h1>
    <p>Are you sure you want to unsubscribe? You will no longer receive promotional emails or texts from us.</p>
    <form method="POST" action="/api/public/unsubscribe">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit">Unsubscribe</button>
    </form>
    <a class="cancel" href="javascript:window.close()">Cancel</a>
  </div>
</body>
</html>`

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (error) {
    console.error('[Unsubscribe] GET error:', error)
    return htmlResponse('Error', 'Something went wrong. Please try again later.', 500)
  }
})

// POST - Process unsubscribe
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    let token: string | null = null

    // Accept both form data and JSON
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData()
      token = formData.get('token') as string
    } else {
      const body = await request.json().catch(() => ({}))
      token = (body as { token?: string }).token || null
    }

    if (!token) {
      return htmlResponse('Invalid Request', 'Missing unsubscribe token.', 400)
    }

    const parsed = parseToken(token)
    if (!parsed) {
      return htmlResponse('Invalid Link', 'This unsubscribe link is invalid or has expired.', 400)
    }

    // Set customer marketingOptIn = false
    await db.customer.update({
      where: { id: parsed.customerId },
      data: { marketingOptIn: false },
    })

    // Update any pending MarketingRecipient records to 'unsubscribed'
    await db.$executeRawUnsafe(`
      UPDATE "MarketingRecipient"
      SET status = 'unsubscribed', "updatedAt" = NOW()
      WHERE "customerId" = $1 AND status IN ('pending', 'sent', 'delivered')
    `, parsed.customerId)

    // Update unsubscribe count on the campaign
    if (parsed.campaignId) {
      await db.$executeRawUnsafe(`
        UPDATE "MarketingCampaign"
        SET "unsubscribeCount" = "unsubscribeCount" + 1, "updatedAt" = NOW()
        WHERE id = $1
      `, parsed.campaignId)
    }

    console.log(`[Marketing] Customer ${parsed.customerId} unsubscribed via campaign ${parsed.campaignId}`)

    return htmlResponse(
      'Unsubscribed',
      'You have been successfully unsubscribed from marketing messages. You will no longer receive promotional communications from us.',
      200
    )
  } catch (error) {
    console.error('[Unsubscribe] POST error:', error)
    return htmlResponse('Error', 'Something went wrong. Please try again later.', 500)
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseToken(token: string): { customerId: string; campaignId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = decoded.split(':')

    if (parts.length < 3) return null

    const customerId = parts[0]
    const campaignId = parts[1]
    const providedHmac = parts[2]

    // Verify HMAC
    const secret = process.env.MARKETING_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'marketing-fallback-secret'
    const payload = `${customerId}:${campaignId}`
    const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16)

    if (!crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
      return null
    }

    return { customerId, campaignId }
  } catch {
    return null
  }
}

function htmlResponse(title: string, message: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 24px; color: #1f2937; margin: 0 0 12px; }
    p { color: #6b7280; font-size: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`

  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
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
