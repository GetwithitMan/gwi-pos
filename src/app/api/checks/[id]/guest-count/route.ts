import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, validateLease, isLeaseError, resolveLocationId } from '@/lib/check-events'
import { emitToLocation } from '@/lib/socket-server'
import { err, ok } from '@/lib/api-response'

const GuestCountSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  terminalId: z.string().min(1, 'terminalId is required'),
  guestCount: z.number().int().min(1, 'guestCount must be at least 1'),
})

export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkId } = await params
    const rawBody = await request.json()
    const parseResult = GuestCountSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId
    const locationId = await resolveLocationId(request)
    if (!locationId) return err('locationId is required', 400)

    // Auth
    const actor = await getActorFromRequest(request)
    if (actor.employeeId) {
      const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return ok(existing)

    // Validate lease
    const leaseResult = await validateLease(checkId, body.terminalId, locationId)
    if (isLeaseError(leaseResult)) return leaseResult.response
    const previousCount = leaseResult.check.guestCount

    // Update guest count + emit event + record command in one transaction
    const guestPayload = { previousCount, newCount: body.guestCount }
    const result = await db.$transaction(async (tx) => {
      const updatedCheck = await tx.check.update({
        where: { id: checkId },
        data: { guestCount: body.guestCount },
      })

      const eventResult = await emitCheckEventInTx(tx, locationId, checkId, 'CHECK_GUEST_COUNT_CHANGED', guestPayload, { commandId: body.commandId })

      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify(updatedCheck),
        },
      })

      return { check: updatedCheck, eventResult }
    })

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: result.eventResult.eventId,
      checkId,
      serverSequence: result.eventResult.serverSequence,
      type: 'CHECK_GUEST_COUNT_CHANGED',
      payload: guestPayload,
      commandId: body.commandId,
      deviceId: body.terminalId,
    }).catch(console.error)

    return ok(result.check)
  } catch (error) {
    console.error('Failed to update guest count:', error)
    return err('Failed to update guest count', 500)
  }
})
