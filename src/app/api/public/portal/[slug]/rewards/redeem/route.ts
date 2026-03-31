import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { generateRedemptionCode } from '@/lib/portal-auth'
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

  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id", "customerId" FROM "CustomerPortalSession"
     WHERE "sessionToken" = ${token}
       AND "locationId" = ${locationId}
       AND "sessionExpiresAt" > NOW()`

  if (rows.length === 0) return null
  return { customerId: rows[0].customerId as string, sessionId: rows[0].id as string }
}

// POST /api/public/portal/[slug]/rewards/redeem — redeem a reward
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    const body = await request.json()

    // ── Resolve slug → locationId ───────────────────────────────────
    const locations = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "Location" WHERE "slug" = ${slug} LIMIT 1`

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

    // ── Validate body ─────────────────────────────────────────────────
    const { rewardId } = body
    if (!rewardId || typeof rewardId !== 'string') {
      return err('rewardId is required')
    }

    // ── Fetch reward ──────────────────────────────────────────────────
    const rewardRows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "LoyaltyReward"
       WHERE "id" = ${rewardId}
         AND "locationId" = ${locationId}
         AND "isActive" = true
         AND "deletedAt" IS NULL
         AND ("startsAt" IS NULL OR "startsAt" <= NOW())
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`

    if (rewardRows.length === 0) {
      return notFound('Reward not found or not available')
    }

    const reward = rewardRows[0]
    const pointCost = Number(reward.pointCost)

    // ── Check sold out ────────────────────────────────────────────────
    const totalAvailable = Number(reward.totalAvailable ?? 0)
    const totalRedeemed = Number(reward.totalRedeemed ?? 0)
    if (totalAvailable > 0 && totalRedeemed >= totalAvailable) {
      return err('Reward is sold out', 409)
    }

    // ── Check per-customer limit ──────────────────────────────────────
    const maxPerCustomer = Number(reward.maxRedemptionsPerCustomer ?? 0)
    if (maxPerCustomer > 0) {
      const countRows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS "count" FROM "LoyaltyRedemption"
         WHERE "customerId" = ${customerId} AND "rewardId" = ${rewardId} AND "status" != 'cancelled'`
      const customerRedemptions = Number(countRows[0]?.count ?? 0)
      if (customerRedemptions >= maxPerCustomer) {
        return err('Maximum redemptions reached for this reward', 409)
      }
    }

    // ── Fetch customer points ─────────────────────────────────────────
    const customerRows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "loyaltyPoints" FROM "Customer" WHERE "id" = ${customerId}`

    const currentPoints = Number(customerRows[0]?.loyaltyPoints ?? 0)
    if (currentPoints < pointCost) {
      return NextResponse.json(
        { error: 'Not enough loyalty points', required: pointCost, available: currentPoints },
        { status: 400 },
      )
    }

    // ── Deduct points ─────────────────────────────────────────────────
    await db.$executeRaw`UPDATE "Customer"
       SET "loyaltyPoints" = "loyaltyPoints" - ${pointCost}, "updatedAt" = NOW()
       WHERE "id" = ${customerId}`

    // ── Generate redemption code (retry on collision) ─────────────────
    let redemptionCode: string
    let attempts = 0
    while (true) {
      redemptionCode = generateRedemptionCode()
      const existing = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT 1 FROM "LoyaltyRedemption" WHERE "redemptionCode" = ${redemptionCode}`
      if (existing.length === 0) break
      attempts++
      if (attempts > 5) {
        // Extremely unlikely — restore points and bail
        await db.$executeRaw`UPDATE "Customer" SET "loyaltyPoints" = "loyaltyPoints" + ${pointCost}, "updatedAt" = NOW() WHERE "id" = ${customerId}`
        return err('Failed to generate unique code', 500)
      }
    }

    // ── Insert redemption ─────────────────────────────────────────────
    const redemptionId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    await db.$executeRaw`INSERT INTO "LoyaltyRedemption" (
        "id", "locationId", "customerId", "rewardId", "pointsSpent",
        "status", "redemptionCode", "redeemedAt", "expiresAt",
        "createdAt", "updatedAt"
      ) VALUES (
        ${redemptionId}, ${locationId}, ${customerId}, ${rewardId}, ${pointCost},
        'pending', ${redemptionCode}, NOW(), ${expiresAt},
        NOW(), NOW()
      )`

    // ── Return ────────────────────────────────────────────────────────
    const pointsRemaining = currentPoints - pointCost

    return ok({
      redemptionCode,
      expiresAt: expiresAt.toISOString(),
      pointsRemaining,
    })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to redeem loyalty reward:', error)
    return err('Failed to redeem reward', 500)
  }
})
