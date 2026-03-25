import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'

// POST /api/loyalty/enroll — enroll a customer in a loyalty program
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

    const { customerId, programId } = body

    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    // Find program — if programId not given, use the location's active program
    let resolvedProgramId = programId
    if (!resolvedProgramId) {
      const programs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id" FROM "LoyaltyProgram"
         WHERE "locationId" = $1 AND "isActive" = true AND "deletedAt" IS NULL
         LIMIT 1`,
        locationId,
      )
      if (programs.length === 0) {
        return NextResponse.json({ error: 'No active loyalty program found' }, { status: 404 })
      }
      resolvedProgramId = programs[0].id
    }

    // Check customer exists and is not already enrolled
    const customers = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "loyaltyProgramId", "loyaltyPoints", "locationId"
       FROM "Customer"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      customerId,
      locationId,
    )

    if (customers.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customers[0]

    if (customer.loyaltyProgramId) {
      return NextResponse.json({ error: 'Customer is already enrolled in a loyalty program' }, { status: 409 })
    }

    // Enroll the customer
    await db.$executeRawUnsafe(
      `UPDATE "Customer"
       SET "loyaltyProgramId" = $2,
           "loyaltyEnrolledAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      customerId,
      resolvedProgramId,
    )

    // Award welcome bonus if configured
    const locationRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "settings" FROM "Location" WHERE "id" = $1`,
      locationId,
    )
    const settings = parseSettings(locationRows[0]?.settings)
    const welcomeBonus = settings.loyalty.welcomeBonus || 0

    if (welcomeBonus > 0) {
      const currentPoints = Number(customer.loyaltyPoints ?? 0)
      const txnId = crypto.randomUUID()

      await db.$executeRawUnsafe(
        `INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
        ) VALUES ($1, $2, $3, 'welcome', $4, $5, $6, $7, $8, NOW())`,
        txnId,
        customerId,
        locationId,
        welcomeBonus,
        currentPoints,
        currentPoints + welcomeBonus,
        `Welcome bonus: ${welcomeBonus} points`,
        employeeId || null,
      )

      await db.$executeRawUnsafe(
        `UPDATE "Customer"
         SET "loyaltyPoints" = "loyaltyPoints" + $2,
             "lifetimePoints" = "lifetimePoints" + $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        customerId,
        welcomeBonus,
      )
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated' })

    return NextResponse.json({
      success: true,
      programId: resolvedProgramId,
      welcomeBonusAwarded: welcomeBonus,
    })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return NextResponse.json({ error: 'Loyalty system not yet configured. Please run database migrations.' }, { status: 503 })
    }
    console.error('Failed to enroll in loyalty program:', error)
    return NextResponse.json({ error: 'Failed to enroll in loyalty program' }, { status: 500 })
  }
})
