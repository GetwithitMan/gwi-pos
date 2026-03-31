import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, notFound, ok } from '@/lib/api-response'

// POST /api/loyalty/enroll — enroll a customer in a loyalty program
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return err('locationId is required')
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
      return err('customerId is required')
    }

    // Find program — if programId not given, use the location's active program
    let resolvedProgramId = programId
    if (!resolvedProgramId) {
      const programs = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id" FROM "LoyaltyProgram"
         WHERE "locationId" = ${locationId} AND "isActive" = true AND "deletedAt" IS NULL
         LIMIT 1`
      if (programs.length === 0) {
        return notFound('No active loyalty program found')
      }
      resolvedProgramId = programs[0].id
    }

    // Check customer exists and is not already enrolled
    const customers = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "id", "loyaltyProgramId", "loyaltyPoints", "locationId"
       FROM "Customer"
       WHERE "id" = ${customerId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL`

    if (customers.length === 0) {
      return notFound('Customer not found')
    }

    const customer = customers[0]

    if (customer.loyaltyProgramId) {
      return err('Customer is already enrolled in a loyalty program', 409)
    }

    // Enroll the customer
    await db.$executeRaw`UPDATE "Customer"
       SET "loyaltyProgramId" = ${resolvedProgramId},
           "loyaltyEnrolledAt" = NOW(),
           "updatedAt" = NOW()
       WHERE "id" = ${customerId}`

    // Award welcome bonus if configured
    const locationRows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "settings" FROM "Location" WHERE "id" = ${locationId}`
    const settings = parseSettings(locationRows[0]?.settings)
    const welcomeBonus = settings.loyalty.welcomeBonus || 0

    if (welcomeBonus > 0) {
      const currentPoints = Number(customer.loyaltyPoints ?? 0)
      const txnId = crypto.randomUUID()

      const description = `Welcome bonus: ${welcomeBonus} points`
      await db.$executeRaw`INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
        ) VALUES (${txnId}, ${customerId}, ${locationId}, 'welcome', ${welcomeBonus}, ${currentPoints}, ${currentPoints + welcomeBonus}, ${description}, ${employeeId || null}, NOW())`

      await db.$executeRaw`UPDATE "Customer"
         SET "loyaltyPoints" = "loyaltyPoints" + ${welcomeBonus},
             "lifetimePoints" = "lifetimePoints" + ${welcomeBonus},
             "updatedAt" = NOW()
         WHERE "id" = ${customerId}`
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated' })

    return ok({
      success: true,
      programId: resolvedProgramId,
      welcomeBonusAwarded: welcomeBonus,
    })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to enroll in loyalty program:', error)
    return err('Failed to enroll in loyalty program', 500)
  }
})
