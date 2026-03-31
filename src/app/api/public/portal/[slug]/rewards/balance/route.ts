import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * Verify the portal_session cookie and return session data.
 */
async function verifyPortalSession(locationId: string): Promise<{
  customerId: string
  sessionId: string
} | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('portal_session')?.value
  if (!token) return null

  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id", "customerId" FROM "CustomerPortalSession"
     WHERE "sessionToken" = ${token}
       AND "locationId" = ${locationId}
       AND "sessionExpiresAt" > NOW()`

  if (rows.length === 0) return null
  return { customerId: rows[0].customerId as string, sessionId: rows[0].id as string }
}

// GET /api/public/portal/[slug]/rewards/balance — customer's full loyalty context
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params

    // Resolve slug
    const locations = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "Location" WHERE "slug" = ${slug} LIMIT 1`

    if (locations.length === 0) {
      return notFound('Location not found')
    }

    const locationId = locations[0].id as string

    // Session auth
    const session = await verifyPortalSession(locationId)
    if (!session) {
      return unauthorized('Unauthorized')
    }

    const customerId = session.customerId

    // Fetch customer with tier info
    const customers = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT c."loyaltyPoints", c."lifetimePoints", c."loyaltyProgramId",
              c."loyaltyTierId", c."loyaltyEnrolledAt",
              lt."name" AS "tierName", lt."color" AS "tierColor",
              lt."pointsMultiplier" AS "tierMultiplier",
              lt."perks" AS "tierPerks"
       FROM "Customer" c
       LEFT JOIN "LoyaltyTier" lt ON lt."id" = c."loyaltyTierId"
       WHERE c."id" = ${customerId}`

    if (customers.length === 0) {
      return notFound('Customer not found')
    }

    const customer = customers[0]
    const lifetimePoints = Number(customer.lifetimePoints ?? 0)

    // Next tier
    let nextTier: Record<string, unknown> | null = null
    if (customer.loyaltyProgramId) {
      const nextTiers = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "name", "minimumPoints", "color"
         FROM "LoyaltyTier"
         WHERE "programId" = ${customer.loyaltyProgramId}
           AND "minimumPoints" > ${lifetimePoints}
           AND "deletedAt" IS NULL
         ORDER BY "minimumPoints" ASC
         LIMIT 1`
      if (nextTiers.length > 0) {
        nextTier = {
          name: nextTiers[0].name,
          minimumPoints: Number(nextTiers[0].minimumPoints),
          color: nextTiers[0].color,
          pointsNeeded: Number(nextTiers[0].minimumPoints) - lifetimePoints,
        }
      }
    }

    // Recent transactions (last 20, scoped to location)
    const transactions = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id", "type", "points", "description", "createdAt"
       FROM "LoyaltyTransaction"
       WHERE "customerId" = ${customerId} AND "locationId" = ${locationId}
       ORDER BY "createdAt" DESC
       LIMIT 20`

    return ok({
      points: Number(customer.loyaltyPoints),
      lifetimePoints,
      enrolledAt: customer.loyaltyEnrolledAt,
      tier: customer.loyaltyTierId
        ? {
            name: customer.tierName,
            color: customer.tierColor,
            multiplier: Number(customer.tierMultiplier ?? 1),
            perks: customer.tierPerks,
          }
        : null,
      nextTier,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        points: Number(t.points),
        description: t.description,
        createdAt: t.createdAt,
      })),
    })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to fetch loyalty balance:', error)
    return err('Failed to fetch balance', 500)
  }
})
