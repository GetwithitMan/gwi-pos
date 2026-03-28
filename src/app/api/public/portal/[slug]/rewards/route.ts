import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * Verify the portal_session cookie and return session data.
 * Returns null if invalid/expired.
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

// GET /api/public/portal/[slug]/rewards — list available rewards + customer points
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params

    // ── Resolve slug → locationId ───────────────────────────────────
    const locations = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id" FROM "Location" WHERE "slug" = $1 LIMIT 1`,
      slug,
    )

    if (locations.length === 0) {
      return notFound('Location not found')
    }

    const locationId = locations[0].id as string

    // ── Session auth ──────────────────────────────────────────────────
    const session = await verifyPortalSession(locationId)
    if (!session) {
      return unauthorized('Unauthorized — please log in')
    }

    const customerId = session.customerId

    // ── Fetch customer loyalty points ─────────────────────────────────
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "loyaltyPoints" FROM "Customer" WHERE "id" = $1`,
      customerId,
    )

    const points = Number(customers[0]?.loyaltyPoints ?? 0)

    // ── Fetch available rewards ───────────────────────────────────────
    const rewards = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "name", "description", "imageUrl", "pointCost", "rewardType",
              "rewardValue", "applicableTo", "maxRedemptionsPerCustomer",
              "totalAvailable", "totalRedeemed", "startsAt", "expiresAt", "sortOrder"
       FROM "LoyaltyReward"
       WHERE "locationId" = $1
         AND "isActive" = true
         AND "deletedAt" IS NULL
         AND ("startsAt" IS NULL OR "startsAt" <= NOW())
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
         AND ("totalAvailable" = 0 OR "totalAvailable" > "totalRedeemed")
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      locationId,
    )

    // ── Check per-customer redemption limits ──────────────────────────
    const rewardsWithAvailability = await Promise.all(
      rewards.map(async (reward) => {
        const maxPerCustomer = Number(reward.maxRedemptionsPerCustomer ?? 0)
        let customerRedemptions = 0
        let redeemable = true

        if (maxPerCustomer > 0) {
          const countRows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) AS "count" FROM "LoyaltyRedemption"
             WHERE "customerId" = $1 AND "rewardId" = $2 AND "status" != 'cancelled'`,
            customerId,
            reward.id,
          )
          customerRedemptions = Number(countRows[0]?.count ?? 0)
          if (customerRedemptions >= maxPerCustomer) {
            redeemable = false
          }
        }

        // Also check if customer has enough points
        if (Number(reward.pointCost) > points) {
          redeemable = false
        }

        return {
          ...reward,
          customerRedemptions,
          redeemable,
        }
      }),
    )

    return ok({ points, rewards: rewardsWithAvailability })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to list portal rewards:', error)
    return err('Failed to list rewards', 500)
  }
})
