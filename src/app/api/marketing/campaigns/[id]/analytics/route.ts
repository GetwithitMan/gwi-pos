import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Detailed analytics for a campaign
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    // Verify campaign exists
    const campaigns = await db.$queryRawUnsafe(`
      SELECT id, name, type, status, "recipientCount", "deliveredCount",
             "openCount", "clickCount", "unsubscribeCount", "sentAt", "createdAt"
      FROM "MarketingCampaign"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, id, locationId) as Record<string, unknown>[]

    if (campaigns.length === 0) {
      return notFound('Campaign not found')
    }

    const campaign = campaigns[0]
    const recipientCount = (campaign.recipientCount as number) || 0

    // Per-status breakdown
    const statusBreakdown = await db.$queryRawUnsafe(`
      SELECT status, COUNT(*)::int as count
      FROM "MarketingRecipient"
      WHERE "campaignId" = $1
      GROUP BY status
      ORDER BY count DESC
    `, id) as { status: string; count: number }[]

    // Build rate calculations
    const delivered = (campaign.deliveredCount as number) || 0
    const opened = (campaign.openCount as number) || 0
    const clicked = (campaign.clickCount as number) || 0
    const unsubscribed = (campaign.unsubscribeCount as number) || 0

    const rates = {
      deliveryRate: recipientCount > 0 ? Math.round((delivered / recipientCount) * 10000) / 100 : 0,
      openRate: delivered > 0 ? Math.round((opened / delivered) * 10000) / 100 : 0,
      clickRate: delivered > 0 ? Math.round((clicked / delivered) * 10000) / 100 : 0,
      unsubscribeRate: delivered > 0 ? Math.round((unsubscribed / delivered) * 10000) / 100 : 0,
    }

    // Timeline: sends per hour for the campaign
    const timeline = await db.$queryRawUnsafe(`
      SELECT
        date_trunc('hour', "sentAt") as hour,
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked'))::int as delivered,
        COUNT(*) FILTER (WHERE status = 'bounced')::int as bounced
      FROM "MarketingRecipient"
      WHERE "campaignId" = $1 AND "sentAt" IS NOT NULL
      GROUP BY date_trunc('hour', "sentAt")
      ORDER BY hour
    `, id) as Record<string, unknown>[]

    // Error summary
    const errors = await db.$queryRawUnsafe(`
      SELECT "errorMessage", COUNT(*)::int as count
      FROM "MarketingRecipient"
      WHERE "campaignId" = $1 AND "errorMessage" IS NOT NULL
      GROUP BY "errorMessage"
      ORDER BY count DESC
      LIMIT 10
    `, id) as { errorMessage: string; count: number }[]

    return ok({
        campaign: {
          id: campaign.id,
          name: campaign.name,
          type: campaign.type,
          status: campaign.status,
          sentAt: campaign.sentAt,
        },
        totals: {
          recipients: recipientCount,
          delivered,
          opened,
          clicked,
          unsubscribed,
        },
        rates,
        statusBreakdown,
        timeline,
        errors,
      })
  } catch (error) {
    console.error('[Marketing] Failed to get analytics:', error)
    return err('Failed to get analytics', 500)
  }
})
