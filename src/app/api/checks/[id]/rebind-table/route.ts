import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, validateLease, isLeaseError, resolveLocationId } from '@/lib/check-events'
import { dispatchChecksListChanged } from '@/lib/socket-dispatch/check-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { err, ok } from '@/lib/api-response'

const RebindTableSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  terminalId: z.string().min(1, 'terminalId is required'),
  newTableId: z.string().min(1, 'newTableId is required'),
  employeeId: z.string().min(1, 'employeeId is required'),
})

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkId } = await params
    const rawBody = await request.json()
    const parseResult = RebindTableSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId
    const locationId = await resolveLocationId(request)
    if (!locationId) return err('locationId is required', 400)

    // Auth
    const auth = await requirePermission(body.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return ok(existing)

    // Validate lease
    const leaseResult = await validateLease(checkId, body.terminalId, locationId)
    if (isLeaseError(leaseResult)) return leaseResult.response
    const previousTableId = leaseResult.check.tableId

    // Update table + emit event + record command in one transaction
    const rebindPayload = {
      previousTableId: previousTableId ?? '',
      newTableId: body.newTableId,
      employeeId: body.employeeId,
    }
    const result = await db.$transaction(async (tx) => {
      const updatedCheck = await tx.check.update({
        where: { id: checkId },
        data: { tableId: body.newTableId },
      })

      const eventResult = await emitCheckEventInTx(tx, locationId, checkId, 'CHECK_TABLE_REBOUND', rebindPayload, { commandId: body.commandId })

      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify(updatedCheck),
        },
      })

      return { check: updatedCheck, eventResult }
    })

    // Socket dispatch — fire-and-forget AFTER txn (best-effort)
    void dispatchChecksListChanged(locationId)

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: result.eventResult.eventId,
      checkId,
      serverSequence: result.eventResult.serverSequence,
      type: 'CHECK_TABLE_REBOUND',
      payload: rebindPayload,
      commandId: body.commandId,
      deviceId: body.terminalId,
    }).catch(console.error)

    return ok(result.check)
  } catch (error) {
    console.error('Failed to rebind check table:', error)
    return err('Failed to rebind check table', 500)
  }
})
