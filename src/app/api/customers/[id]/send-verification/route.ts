import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Send SMS verification to customer
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const body = await request.json()
    const { locationId, message: customMessage } = body

    if (!locationId) {
      return err('Location ID is required')
    }

    if (!isTwilioConfigured()) {
      return err('SMS is not configured. Set Twilio credentials in environment.', 503)
    }

    // Verify customer exists and has a phone number
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })

    if (!customer) {
      return notFound('Customer not found')
    }

    if (!customer.phone) {
      return err('Customer does not have a phone number on file')
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
      return err(result.error || 'Failed to send SMS', 502)
    }

    return ok({
      success: true,
      messageSid: result.messageSid,
    })
  } catch (error) {
    console.error('Failed to send verification SMS:', error)
    return err('Failed to send verification SMS', 500)
  }
}))
