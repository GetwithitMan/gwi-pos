import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'

// POST /api/loyalty/tier-check — recalculate customer's tier based on lifetime points
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const { customerId } = body

    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    // Fetch customer
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "loyaltyPoints", "lifetimePoints", "loyaltyProgramId", "loyaltyTierId"
       FROM "Customer"
       WHERE "id" = $1 AND "deletedAt" IS NULL`,
      customerId,
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customers[0]

    if (!customer.loyaltyProgramId) {
      return NextResponse.json({ error: 'Customer is not enrolled in a loyalty program' }, { status: 400 })
    }

    const lifetimePoints = Number(customer.lifetimePoints)

    // Find the highest tier they qualify for
    const tiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "name", "minimumPoints"
       FROM "LoyaltyTier"
       WHERE "programId" = $1 AND "deletedAt" IS NULL
       ORDER BY "minimumPoints" DESC`,
      customer.loyaltyProgramId,
    )

    let newTierId: string | null = null
    let newTierName: string | null = null
    for (const tier of tiers) {
      if (lifetimePoints >= Number(tier.minimumPoints)) {
        newTierId = tier.id as string
        newTierName = tier.name as string
        break
      }
    }

    const previousTierId = customer.loyaltyTierId as string | null
    const changed = newTierId !== previousTierId

    if (changed) {
      await db.$executeRawUnsafe(
        `UPDATE "Customer" SET "loyaltyTierId" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
        customerId,
        newTierId,
      )

      // Record tier change transaction
      const txnId = crypto.randomUUID()
      const description = newTierName
        ? `Tier recalculated: promoted to ${newTierName}`
        : 'Tier recalculated: tier removed'

      await db.$executeRawUnsafe(
        `INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
        ) VALUES ($1, $2, $3, 'tier_bonus', 0, $4, $4, $5, $6, NOW())`,
        txnId,
        customerId,
        locationId,
        Number(customer.loyaltyPoints),
        description,
        employeeId || null,
      )

      pushUpstream()
      void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated' })
    }

    return NextResponse.json({
      data: {
        customerId,
        lifetimePoints,
        previousTierId,
        newTierId,
        newTierName,
        changed,
      },
    })
  } catch (error) {
    console.error('Failed to check loyalty tier:', error)
    return NextResponse.json({ error: 'Failed to check loyalty tier' }, { status: 500 })
  }
})
