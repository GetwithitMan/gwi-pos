import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/loyalty/balance?customerId=X — returns points balance, tier info, recent transactions
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const customerId = searchParams.get('customerId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // Fetch customer with tier
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c."id", c."firstName", c."lastName", c."loyaltyPoints", c."lifetimePoints",
              c."loyaltyProgramId", c."loyaltyTierId", c."loyaltyEnrolledAt",
              lt."name" AS "tierName", lt."color" AS "tierColor", lt."pointsMultiplier",
              lt."perks" AS "tierPerks", lt."minimumPoints" AS "tierMinPoints"
       FROM "Customer" c
       LEFT JOIN "LoyaltyTier" lt ON lt."id" = c."loyaltyTierId"
       WHERE c."id" = $1 AND c."deletedAt" IS NULL`,
      customerId,
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customers[0]

    // Get next tier info
    let nextTier: Record<string, unknown> | null = null
    if (customer.loyaltyProgramId) {
      const nextTiers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id", "name", "minimumPoints", "color", "pointsMultiplier", "perks"
         FROM "LoyaltyTier"
         WHERE "programId" = $1
           AND "minimumPoints" > $2
           AND "deletedAt" IS NULL
         ORDER BY "minimumPoints" ASC
         LIMIT 1`,
        customer.loyaltyProgramId,
        Number(customer.lifetimePoints),
      )
      if (nextTiers.length > 0) {
        nextTier = nextTiers[0]
      }
    }

    // Get program info
    let program: Record<string, unknown> | null = null
    if (customer.loyaltyProgramId) {
      const programs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id", "name", "pointsPerDollar", "pointValueCents", "minimumRedeemPoints"
         FROM "LoyaltyProgram"
         WHERE "id" = $1 AND "deletedAt" IS NULL`,
        customer.loyaltyProgramId,
      )
      if (programs.length > 0) {
        program = programs[0]
      }
    }

    // Get recent transactions (last 20)
    const transactions = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "type", "points", "balanceBefore", "balanceAfter",
              "description", "orderId", "createdAt"
       FROM "LoyaltyTransaction"
       WHERE "customerId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 20`,
      customerId,
    )

    return NextResponse.json({
      data: {
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        points: Number(customer.loyaltyPoints),
        lifetimePoints: Number(customer.lifetimePoints),
        enrolledAt: customer.loyaltyEnrolledAt,
        isEnrolled: !!customer.loyaltyProgramId,
        tier: customer.loyaltyTierId
          ? {
              id: customer.loyaltyTierId,
              name: customer.tierName,
              color: customer.tierColor,
              multiplier: Number(customer.pointsMultiplier),
              perks: customer.tierPerks,
              minimumPoints: Number(customer.tierMinPoints),
            }
          : null,
        nextTier: nextTier
          ? {
              id: nextTier.id,
              name: nextTier.name,
              minimumPoints: Number(nextTier.minimumPoints),
              color: nextTier.color,
              pointsNeeded: Number(nextTier.minimumPoints) - Number(customer.lifetimePoints),
            }
          : null,
        program,
        recentTransactions: transactions,
      },
    })
  } catch (error) {
    console.error('Failed to fetch loyalty balance:', error)
    return NextResponse.json({ error: 'Failed to fetch loyalty balance' }, { status: 500 })
  }
})
