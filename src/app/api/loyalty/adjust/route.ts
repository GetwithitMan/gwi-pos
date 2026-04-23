import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { err, ok } from '@/lib/api-response'

// POST /api/loyalty/adjust — manually adjust a customer's loyalty balance.
//
// T8b remediation: this is the ONLY path for manual loyalty balance changes.
// Direct Customer.loyaltyPoints writes in PUT /api/customers/[id] are rejected.
// Every adjustment writes a LoyaltyTransaction audit row (type='admin_adjustment').
//
// Body: { customerId, points (signed int), reason (required string), employeeId }
// Rules:
//   - Requires LOYALTY_ADJUST permission
//   - Customer must exist in this location (not soft-deleted)
//   - Customer.loyaltyPoints can go down to 0 (GREATEST guard)
//   - Customer.lifetimePoints is ONLY increased when points > 0 — a manual
//     adjustment-down does NOT demote tier or reduce lifetime totals.
//   - Cloud routes set lastMutatedBy: 'cloud' (per CLAUDE.md)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return err('locationId is required')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.LOYALTY_ADJUST)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const { customerId, points, reason } = body

    if (!customerId || typeof customerId !== 'string') {
      return err('customerId is required')
    }
    if (typeof points !== 'number' || !Number.isFinite(points) || !Number.isInteger(points) || points === 0) {
      return err('points must be a non-zero integer (positive or negative)')
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return err('reason is required')
    }
    const trimmedReason = reason.trim()

    const result = await db.$transaction(async (tx) => {
      // Lock the Customer row to serialize concurrent loyalty operations
      const customers = await tx.$queryRaw<Array<Record<string, unknown>>>`SELECT "id", "loyaltyPoints", "lifetimePoints"
         FROM "Customer"
         WHERE "id" = ${customerId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
         FOR UPDATE`

      if (customers.length === 0) {
        return { error: 'Customer not found', status: 404 } as const
      }

      const customer = customers[0]
      const balanceBefore = Number(customer.loyaltyPoints)
      const lifetimeBefore = Number(customer.lifetimePoints)

      // Apply the delta. Balance floors at 0 (GREATEST guard) — a negative
      // adjustment larger than the current balance zeroes the account rather
      // than going negative. Lifetime only increases on positive adjustments.
      if (points > 0) {
        await tx.$executeRaw`UPDATE "Customer"
           SET "loyaltyPoints"  = "loyaltyPoints"  + ${points},
               "lifetimePoints" = "lifetimePoints" + ${points},
               "updatedAt"      = NOW(),
               "lastMutatedBy"  = ${process.env.VERCEL ? 'cloud' : 'local'}
           WHERE "id" = ${customerId}`
      } else {
        await tx.$executeRaw`UPDATE "Customer"
           SET "loyaltyPoints"  = GREATEST(0, "loyaltyPoints" + ${points}),
               "updatedAt"      = NOW(),
               "lastMutatedBy"  = ${process.env.VERCEL ? 'cloud' : 'local'}
           WHERE "id" = ${customerId}`
      }

      // Read back the actual post-adjust balance (GREATEST may clamp points < 0)
      const updated = await tx.$queryRaw<Array<Record<string, unknown>>>`SELECT "loyaltyPoints", "lifetimePoints" FROM "Customer" WHERE "id" = ${customerId}`
      const balanceAfter = Number(updated[0].loyaltyPoints)
      const lifetimeAfter = Number(updated[0].lifetimePoints)
      const actualDelta = balanceAfter - balanceBefore

      const txnId = crypto.randomUUID()
      const description = `Manual adjustment: ${trimmedReason}`
      const metadata = JSON.stringify({
        reason: trimmedReason,
        requestedDelta: points,
        actualDelta,
        lifetimeBefore,
        lifetimeAfter,
      })

      await tx.$executeRaw`INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId",
          "metadata", "createdAt"
        ) VALUES (${txnId}, ${customerId}, ${locationId}, 'admin_adjustment', ${actualDelta}, ${balanceBefore}, ${balanceAfter}, ${description}, ${employeeId || null}, ${metadata}::jsonb, NOW())`

      return {
        data: {
          transactionId: txnId,
          customerId,
          requestedDelta: points,
          actualDelta,
          balanceBefore,
          balanceAfter,
          lifetimeBefore,
          lifetimeAfter,
          reason: trimmedReason,
        },
      } as const
    }, { timeout: 15000 })

    if ('error' in result) {
      return err(result.error!, result.status)
    }

    pushUpstream()
    void notifyDataChanged({ locationId, domain: 'loyalty', action: 'updated', entityId: result.data.customerId })

    return ok(result.data)
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to adjust loyalty points:', error)
    return err('Failed to adjust loyalty points', 500)
  }
})
