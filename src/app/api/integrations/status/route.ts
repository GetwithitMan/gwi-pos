import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { db } from '@/lib/db'

export const GET = withVenue(async function GET() {
  // Read integration settings from DB (not env vars)
  let oraclePmsConfigured = false
  let sevenShiftsConfigured = false
  let marginEdgeConfigured = false
  let slackConfigured = !!process.env.SLACK_WEBHOOK_URL
  try {
    const location = await db.location.findFirst({ select: { id: true } })
    if (location) {
      const settings = parseSettings(await getLocationSettings(location.id))
      const pms = settings.hotelPms
      oraclePmsConfigured = !!(pms?.enabled && pms.baseUrl && pms.clientId && pms.clientSecret && pms.appKey && pms.hotelId)
      const s7 = settings.sevenShifts
      sevenShiftsConfigured = !!(s7?.enabled && s7.clientId && s7.clientSecret && s7.companyId && s7.companyGuid)
      const me = settings.marginEdge
      marginEdgeConfigured = !!(me?.enabled && me.apiKey)
      // Slack: DB setting takes priority, env var is fallback
      if (settings.alerts?.slackWebhookUrl) {
        slackConfigured = true
      }
    }
  } catch {
    // Non-fatal — status check should not throw
  }

  return NextResponse.json({ data: {
    twilio: {
      configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
      fromNumber: process.env.TWILIO_FROM_NUMBER ? `***${process.env.TWILIO_FROM_NUMBER.slice(-4)}` : null,
    },
    resend: {
      configured: !!process.env.RESEND_API_KEY,
    },
    slack: {
      configured: slackConfigured,
    },
    oraclePms: {
      configured: oraclePmsConfigured,
    },
    sevenShifts: {
      configured: sevenShiftsConfigured,
    },
    marginEdge: {
      configured: marginEdgeConfigured,
    },
  } })
})
