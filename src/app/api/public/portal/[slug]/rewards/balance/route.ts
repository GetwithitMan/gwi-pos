import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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

  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT "id", "customerId" FROM "CustomerPortalSession"
     WHERE "sessionToken" = $1
       AND "locationId" = $2
       AND "sessionExpiresAt" > NOW()`,
    token,
    locationId,
  )

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
    const locations = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "Location" WHERE "slug" = $1 LIMIT 1`,
      slug,
    )

    if (locations.length === 0) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const locationId = locations[0].id as string

    // Session auth
    const session = await verifyPortalSession(locationId)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const customerId = session.customerId

    // Fetch customer with tier info
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c."loyaltyPoints", c."lifetimePoints", c."loyaltyProgramId",
              c."loyaltyTierId", c."loyaltyEnrolledAt",
              lt."name" AS "tierName", lt."color" AS "tierColor",
              lt."pointsMultiplier" AS "tierMultiplier",
              lt."perks" AS "tierPerks"
       FROM "Customer" c
       LEFT JOIN "LoyaltyTier" lt ON lt."id" = c."loyaltyTierId"
       WHERE c."id" = $1`,
      customerId,
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customers[0]
    const lifetimePoints = Number(customer.lifetimePoints ?? 0)

    // Next tier
    let nextTier: Record<string, unknown> | null = null
    if (customer.loyaltyProgramId) {
      const nextTiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "name", "minimumPoints", "color"
         FROM "LoyaltyTier"
         WHERE "programId" = $1
           AND "minimumPoints" > $2
           AND "deletedAt" IS NULL
         ORDER BY "minimumPoints" ASC
         LIMIT 1`,
        customer.loyaltyProgramId,
        lifetimePoints,
      )
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
    const transactions = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "type", "points", "description", "createdAt"
       FROM "LoyaltyTransaction"
       WHERE "customerId" = $1 AND "locationId" = $2
       ORDER BY "createdAt" DESC
       LIMIT 20`,
      customerId,
      locationId,
    )

    return NextResponse.json({
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
      return NextResponse.json({ error: 'Loyalty system not yet configured. Please run database migrations.' }, { status: 503 })
    }
    console.error('Failed to fetch loyalty balance:', error)
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 })
  }
})
