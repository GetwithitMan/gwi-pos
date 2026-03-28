import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Activate a pending house account
// Requires: customer has a linked CardProfile (card on file) AND phone verified
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const account = await db.houseAccount.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            phone: true,
            tags: true,
            locationId: true,
          },
        },
      },
    })

    if (!account) {
      return notFound('House account not found')
    }

    if (account.status === 'active') {
      return err('House account is already active')
    }

    if (account.status !== 'pending') {
      return err(`Cannot activate account with status '${account.status}'`)
    }

    const missing: string[] = []

    // Check 1: Card on file — customer must have at least one CardProfile
    if (account.customerId) {
      const cardCount = await db.cardProfile.count({
        where: {
          customerId: account.customerId,
          locationId: account.locationId,
        },
      })
      if (cardCount === 0) {
        missing.push('Card on file required')
      }
    } else {
      missing.push('Card on file required (no linked customer)')
    }

    // Check 2: SMS verification — customer must have phone + house_account_verified tag
    const customer = account.customer
    if (!customer?.phone) {
      missing.push('Customer phone number required for SMS verification')
    } else {
      const tags = Array.isArray(customer.tags) ? customer.tags as string[] : []
      if (!tags.includes('house_account_verified')) {
        missing.push('SMS verification not completed')
      }
    }

    if (missing.length > 0) {
      return err('Cannot activate house account')
    }

    // All checks passed — activate
    const updated = await db.houseAccount.update({
      where: { id },
      data: { status: 'active', lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
    })

    void notifyDataChanged({ locationId: account.locationId, domain: 'house-accounts', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
        id: updated.id,
        status: updated.status,
        activatedAt: new Date().toISOString(),
      })
  } catch (error) {
    console.error('Failed to activate house account:', error)
    return err('Failed to activate house account', 500)
  }
}))
