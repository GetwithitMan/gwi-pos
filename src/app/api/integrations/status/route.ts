import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET() {
  return NextResponse.json({
    twilio: {
      configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
      fromNumber: process.env.TWILIO_FROM_NUMBER ? `***${process.env.TWILIO_FROM_NUMBER.slice(-4)}` : null,
    },
    resend: {
      configured: !!process.env.RESEND_API_KEY,
    },
    slack: {
      configured: !!process.env.SLACK_WEBHOOK_URL,
    },
  })
})
