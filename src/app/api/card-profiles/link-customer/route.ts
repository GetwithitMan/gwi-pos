import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitToLocation } from '@/lib/socket-server'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Link a CardProfile to a Customer record
// Used when staff manually associates a recognized card with a customer profile
// (e.g., after recognizing a returning customer by card)
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, cardProfileId, customerId } = body

    if (!locationId || !cardProfileId || !customerId) {
      return err('Missing required fields: locationId, cardProfileId, customerId')
    }

    // Verify card profile exists and belongs to this location
    const profile = await db.cardProfile.findFirst({
      where: {
        id: cardProfileId,
        locationId,
        deletedAt: null,
      },
    })

    if (!profile) {
      return notFound('Card profile not found')
    }

    // Verify customer exists and belongs to this location
    const customer = await db.customer.findFirst({
      where: {
        id: customerId,
        locationId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    })

    if (!customer) {
      return notFound('Customer not found')
    }

    // Link the card profile to the customer
    const updated = await db.cardProfile.update({
      where: { id: cardProfileId },
      data: { customerId },
    })

    void emitToLocation(locationId, 'customers:changed', { locationId }).catch(console.error)

    return ok({
        profileId: updated.id,
        customerId: updated.customerId,
        customerName: customer.displayName || `${customer.firstName} ${customer.lastName}`,
        cardType: updated.cardType,
        cardLast4: updated.cardLast4,
      })
  } catch (error) {
    console.error('Failed to link card profile to customer:', error)
    return err('Failed to link card profile to customer', 500)
  }
}))
