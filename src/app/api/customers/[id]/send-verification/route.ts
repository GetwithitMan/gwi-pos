import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'

// POST - Send SMS verification to customer
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const body = await request.json()
    const { locationId, message: customMessage } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!isTwilioConfigured()) {
      return NextResponse.json(
        { error: 'SMS is not configured. Set Twilio credentials in environment.' },
        { status: 503 }
      )
    }

    // Verify customer exists and has a phone number
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (!customer.phone) {
      return NextResponse.json(
        { error: 'Customer does not have a phone number on file' },
        { status: 400 }
      )
    }

    // Get location name for the default message
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true },
    })
    const locationName = location?.name || 'our restaurant'

    const smsBody = customMessage ||
      `Hi ${customer.firstName}, your house account at ${locationName} has been set up. Reply YES to confirm.`

    const result = await sendSMS({
      to: customer.phone,
      body: smsBody,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send SMS' },
        { status: 502 }
      )
    }

    return NextResponse.json({ data: {
      success: true,
      messageSid: result.messageSid,
    } })
  } catch (error) {
    console.error('Failed to send verification SMS:', error)
    return NextResponse.json(
      { error: 'Failed to send verification SMS' },
      { status: 500 }
    )
  }
})
