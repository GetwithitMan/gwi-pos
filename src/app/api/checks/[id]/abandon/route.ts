import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, resolveLocationId } from '@/lib/check-events'
import { dispatchCheckAbandoned, dispatchChecksListChanged } from '@/lib/socket-dispatch/check-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { err, ok, notFound } from '@/lib/api-response'

const AbandonCheckSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  reason: z.string().default('manual'),
  employeeId: z.string().optional(),
})

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkId } = await params
    const rawBody = await request.json()
    const parseResult = AbandonCheckSchema.safeParse(rawBody)
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

    // Load check — abandon doesn't require lease ownership (timeout/cleanup can abandon)
    const check = await db.check.findUnique({ where: { id: checkId } })
    if (!check) return notFound('Check not found')
    if (check.locationId !== locationId) return notFound('Check not found')
    if (check.status !== 'draft') return err('Only draft checks can be abandoned', 409)

    // Abandon check + emit event + release lease + record command in one transaction
    const abandonPayload = { reason: body.reason, employeeId: body.employeeId ?? null }
    const result = await db.$transaction(async (tx) => {
      const updatedCheck = await tx.check.update({
        where: { id: checkId },
        data: {
          status: 'abandoned',
          terminalId: null,
          leaseAcquiredAt: null,
          leaseLastHeartbeatAt: null,
          deletedAt: new Date(),
        },
      })

      const eventResult = await emitCheckEventInTx(tx, locationId, checkId, 'CHECK_ABANDONED', abandonPayload, { commandId: body.commandId })

      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify(updatedCheck),
        },
      })

      return { check: updatedCheck, eventResult }
    })

    // Socket dispatch — fire-and-forget AFTER txn (best-effort)
    void dispatchCheckAbandoned(locationId, checkId)
    void dispatchChecksListChanged(locationId)

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: result.eventResult.eventId,
      checkId,
      serverSequence: result.eventResult.serverSequence,
      type: 'CHECK_ABANDONED',
      payload: abandonPayload,
      commandId: body.commandId,
      deviceId: body.employeeId ?? 'unknown',
    }).catch(console.error)

    return ok(result.check)
  } catch (error) {
    console.error('Failed to abandon check:', error)
    return err('Failed to abandon check', 500)
  }
})
