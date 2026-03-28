import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { created, err, notFound } from '@/lib/api-response'

// POST - Quick-create a house account for a customer
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const body = await request.json()
    const { locationId, creditLimit } = body

    if (!locationId) {
      return err('Location ID is required')
    }

    // Verify customer exists
    const customer = await db.customer.findFirst({
      where: { id: customerId, locationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    })

    if (!customer) {
      return notFound('Customer not found')
    }

    // Check if customer already has a house account at this location
    const existing = await db.houseAccount.findFirst({
      where: { customerId, locationId },
    })

    if (existing) {
      return err('Customer already has a house account', 409)
    }

    // Default name to customer's full name
    const accountName = customer.displayName || `${customer.firstName} ${customer.lastName}`

    const account = await db.houseAccount.create({
      data: {
        locationId,
        customerId,
        name: accountName,
        contactName: `${customer.firstName} ${customer.lastName}`,
        creditLimit: creditLimit || 0,
        status: 'pending',
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void notifyDataChanged({ locationId, domain: 'house-accounts', action: 'created', entityId: account.id })
    void pushUpstream()

    return created({
      id: account.id,
      name: account.name,
      status: account.status,
      currentBalance: Number(account.currentBalance),
      creditLimit: Number(account.creditLimit),
      paymentTerms: account.paymentTerms,
    })
  } catch (error) {
    console.error('Failed to create house account for customer:', error)
    return err('Failed to create house account', 500)
  }
}))
