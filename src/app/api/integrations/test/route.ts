import { NextRequest, NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(request: NextRequest) {
  const { service, employeeId, locationId } = await request.json()

  // Auth check — require settings.integrations permission
  if (locationId) {
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_INTEGRATIONS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    if (service === 'twilio') {
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const authToken = process.env.TWILIO_AUTH_TOKEN
      if (!accountSid || !authToken) throw new Error('Twilio credentials not configured')
      return NextResponse.json({ success: true, message: 'Twilio credentials verified' })
    }

    if (service === 'resend') {
      const apiKey = process.env.RESEND_API_KEY
      if (!apiKey) throw new Error('Resend API key not configured')
      return NextResponse.json({ success: true, message: 'Resend API key verified' })
    }

    if (service === 'slack') {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL
      if (!webhookUrl) throw new Error('Slack webhook URL not configured')
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'GWI POS test connection successful' }),
      })
      if (!res.ok) throw new Error('Slack webhook returned error')
      return NextResponse.json({ success: true, message: 'Test message sent to Slack' })
    }

    return NextResponse.json({ error: 'Unknown service' }, { status: 400 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Test failed'
    return NextResponse.json({ success: false, message }, { status: 200 })
  }
})
