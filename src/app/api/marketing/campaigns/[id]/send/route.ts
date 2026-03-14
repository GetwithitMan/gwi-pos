import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { mergeWithDefaults } from '@/lib/settings'
import { resolveSegment } from '@/lib/marketing/segment-engine'
import { renderEmailHtml, renderSmsBody, buildTemplateVars } from '@/lib/marketing/template-engine'
import { sendEmail } from '@/lib/email-service'
import { sendSMS, formatPhoneE164 } from '@/lib/twilio'
import crypto from 'crypto'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3005'

// POST - Send a campaign
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, employeeId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Load campaign
    const campaigns = await db.$queryRawUnsafe(`
      SELECT * FROM "MarketingCampaign"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId) as Record<string, unknown>[]

    if (campaigns.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const campaign = campaigns[0]

    if (!['draft', 'scheduled'].includes(campaign.status as string)) {
      return NextResponse.json(
        { error: `Cannot send campaign in '${campaign.status}' status` },
        { status: 400 }
      )
    }

    // Load location settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true, name: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = mergeWithDefaults(location.settings as Record<string, unknown>)
    const marketing = settings.marketing

    if (!marketing?.enabled) {
      return NextResponse.json({ error: 'Marketing is not enabled' }, { status: 403 })
    }

    const campaignType = campaign.type as 'email' | 'sms'

    // Check daily send limits
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const sentToday = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "MarketingRecipient" r
      JOIN "MarketingCampaign" c ON c.id = r."campaignId"
      WHERE c."locationId" = $1
        AND r.channel = $2
        AND r."sentAt" >= $3
    `, locationId, campaignType, todayStart) as { count: number }[]

    const sentTodayCount = sentToday[0]?.count ?? 0
    const maxPerDay = campaignType === 'sms' ? marketing.maxSmsPerDay : marketing.maxEmailsPerDay

    // Resolve segment
    const customers = await resolveSegment(
      db as never,
      locationId,
      campaign.segment as string,
      campaignType
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'No eligible recipients found for this segment' }, { status: 400 })
    }

    // Check if sending would exceed daily limit
    const remainingToday = maxPerDay - sentTodayCount
    if (remainingToday <= 0) {
      return NextResponse.json(
        { error: `Daily ${campaignType} send limit (${maxPerDay}) reached. Try again tomorrow.` },
        { status: 429 }
      )
    }

    // Cap recipients at remaining daily limit
    const eligibleCustomers = customers.slice(0, remainingToday)

    // Create recipient records (parameterized inserts to prevent SQL injection)
    for (const c of eligibleCustomers) {
      const address = campaignType === 'email' ? (c.email || '') : (c.phone || '')
      await db.$executeRawUnsafe(
        `INSERT INTO "MarketingRecipient" ("campaignId", "customerId", "channel", "address")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        id, c.id, campaignType, address
      )
    }

    // Update campaign to 'sending' with recipient count
    await db.$executeRawUnsafe(`
      UPDATE "MarketingCampaign"
      SET status = 'sending',
          "recipientCount" = $2,
          "updatedAt" = NOW()
      WHERE id = $1
    `, id, eligibleCustomers.length)

    // Fire-and-forget: process sends in background
    const locationName = location.name || 'Our Restaurant'
    const senderName = marketing.senderName || locationName

    void processCampaignSend(
      id,
      campaign,
      eligibleCustomers,
      campaignType,
      locationName,
      senderName,
      marketing.unsubscribeUrl || `${BASE_URL}/api/public/unsubscribe`
    ).catch((err) => console.error(`[Marketing] Campaign ${id} send error:`, err))

    return NextResponse.json({
      data: {
        campaignId: id,
        recipientCount: eligibleCustomers.length,
        status: 'sending',
        message: `Sending to ${eligibleCustomers.length} recipients...`,
      },
    })
  } catch (error) {
    console.error('[Marketing] Failed to initiate send:', error)
    return NextResponse.json({ error: 'Failed to send campaign' }, { status: 500 })
  }
})

/**
 * Process campaign send in background.
 * Sends in batches with delays to respect rate limits.
 */
async function processCampaignSend(
  campaignId: string,
  campaign: Record<string, unknown>,
  customers: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }[],
  type: 'email' | 'sms',
  locationName: string,
  senderName: string,
  baseUnsubscribeUrl: string
) {
  const batchSize = type === 'email' ? 50 : 10
  const batchDelayMs = 1000
  let deliveredCount = 0

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(async (customer) => {
        // Build per-customer unsubscribe token (HMAC-signed)
        const token = generateUnsubscribeToken(customer.id, campaignId)
        const unsubscribeUrl = `${baseUnsubscribeUrl}?token=${token}`
        const vars = buildTemplateVars(customer, locationName, unsubscribeUrl)

        if (type === 'email' && customer.email) {
          const html = renderEmailHtml(campaign.body as string, vars)
          const subject = campaign.subject
            ? renderTemplate(campaign.subject as string, vars)
            : `${locationName} - Special Offer`

          const result = await sendEmail({
            to: customer.email,
            subject,
            html,
            from: senderName
              ? `${senderName} <${process.env.EMAIL_FROM || 'noreply@gwipos.com'}>`
              : undefined,
          })

          return { customerId: customer.id, success: result.success, error: result.error }
        }

        if (type === 'sms' && customer.phone) {
          const smsBody = renderSmsBody(campaign.body as string, vars)
          const result = await sendSMS({ to: formatPhoneE164(customer.phone), body: smsBody })
          return { customerId: customer.id, success: result.success, error: result.error }
        }

        return { customerId: customer.id, success: false, error: 'No address' }
      })
    )

    // Update individual recipient statuses
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { customerId, success, error } = result.value
        const newStatus = success ? 'sent' : 'bounced'

        await db.$executeRawUnsafe(`
          UPDATE "MarketingRecipient"
          SET status = $1, "sentAt" = NOW(), "errorMessage" = $2, "updatedAt" = NOW()
          WHERE "campaignId" = $3 AND "customerId" = $4
        `, newStatus, error || null, campaignId, customerId)

        if (success) deliveredCount++
      }
    }

    // Delay between batches
    if (i + batchSize < customers.length) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs))
    }
  }

  // Mark campaign as sent with final stats
  await db.$executeRawUnsafe(`
    UPDATE "MarketingCampaign"
    SET status = 'sent',
        "sentAt" = NOW(),
        "deliveredCount" = $2,
        "updatedAt" = NOW()
    WHERE id = $1
  `, campaignId, deliveredCount)

  // Campaign stats returned in response
}

/**
 * Generate an HMAC-signed unsubscribe token encoding customerId and campaignId.
 * Format: base64url(customerId:campaignId:hmac)
 */
function generateUnsubscribeToken(customerId: string, campaignId: string): string {
  const secret = process.env.MARKETING_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('MARKETING_UNSUBSCRIBE_SECRET or JWT_SECRET must be set')
  const payload = `${customerId}:${campaignId}`
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16)
  return Buffer.from(`${payload}:${hmac}`).toString('base64url')
}

/**
 * Simple template variable substitution for subject lines.
 */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '')
}
