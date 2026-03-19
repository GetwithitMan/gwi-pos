import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings, type LocationSettings } from '@/lib/settings'
import { db } from '@/lib/db'

export const GET = withVenue(async function GET() {
  // Read integration settings from DB (not env vars)
  let oraclePmsConfigured = false
  let sevenShiftsConfigured = false
  let marginEdgeConfigured = false
  let slackConfigured = !!process.env.SLACK_WEBHOOK_URL
  let settings: LocationSettings | null = null
  try {
    const location = await db.location.findFirst({ select: { id: true } })
    if (location) {
      settings = parseSettings(await getLocationSettings(location.id))
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

  // Twilio: check DB settings first, then env vars
  let twilioConfigured = false
  let twilioFromNumber: string | null = null
  const tw = settings?.twilio
  if (tw?.accountSid && tw?.authToken && tw?.fromNumber) {
    twilioConfigured = true
    twilioFromNumber = `***${tw.fromNumber.slice(-4)}`
  } else if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    twilioConfigured = true
    twilioFromNumber = `***${process.env.TWILIO_FROM_NUMBER.slice(-4)}`
  }

  return NextResponse.json({ data: {
    twilio: {
      configured: twilioConfigured,
      fromNumber: twilioFromNumber,
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
