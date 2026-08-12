import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, validateLease, isLeaseError, resolveLocationId } from '@/lib/check-events'
import { emitToLocation } from '@/lib/socket-server'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { err, ok, notFound } from '@/lib/api-response'

const CompVoidSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  terminalId: z.string().min(1, 'terminalId is required'),
  action: z.enum(['comp', 'void']),
  reason: z.string().optional(),
  employeeId: z.string().min(1, 'employeeId is required'),
  wasMade: z.boolean().optional(),
  approvalToken: z.string().optional(),
  approvedById: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string; itemId: string }> }

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: checkId, itemId } = await params
    const rawBody = await request.json()
    const parseResult = CompVoidSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId
    const locationId = await resolveLocationId(request)
    if (!locationId) return err('locationId is required', 400)

    // Auth — require POS access (manager approval via approvalToken/approvedById)
    const actor = await getActorFromRequest(request)
    if (actor.employeeId) {
      const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return ok(existing)

    // Validate lease — allow draft and committed
    const leaseResult = await validateLease(checkId, body.terminalId, locationId, {
      allowStatuses: ['draft', 'committed'],
    })
    if (isLeaseError(leaseResult)) return leaseResult.response
    const check = leaseResult.check

    // Verify item exists and is active
    const item = await db.checkItem.findFirst({
      where: { id: itemId, checkId, status: 'active' },
    })
    if (!item) return notFound('Item not found on this check or already comped/voided')

    const newStatus = body.action === 'comp' ? 'comped' : 'voided'
    const isCommitted = check.orderId && check.status !== 'draft'

    const compVoidPayload = {
      lineItemId: itemId,
      action: body.action,
      reason: body.reason ?? null,
      employeeId: body.employeeId,
      approvedById: body.approvedById ?? null,
      wasMade: body.wasMade ?? null,
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Update CheckItem status
      const updatedItem = await tx.checkItem.update({
        where: { id: itemId },
        data: { status: newStatus },
      })

      // 2. Dual-write: update linked OrderItem when committed
      if (isCommitted) {
        await tx.orderItem.update({
          where: { id: itemId },
          data: {
            status: newStatus,
            voidReason: body.reason ?? null,
            wasMade: body.wasMade ?? null,
          },
        })
      }

      await tx.check.update({ where: { id: checkId }, data: { updatedAt: new Date() } })

      // 3. Emit check event
      const eventResult = await emitCheckEventInTx(
        tx, locationId, checkId, 'CHECK_COMP_VOID_APPLIED',
        compVoidPayload, { commandId: body.commandId }
      )

      // 4. Record processed command
      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify({ id: itemId, status: newStatus, action: body.action }),
        },
      })

      return { item: updatedItem, eventResult }
    })

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: result.eventResult.eventId,
      checkId,
      serverSequence: result.eventResult.serverSequence,
      type: 'CHECK_COMP_VOID_APPLIED',
      payload: compVoidPayload,
      commandId: body.commandId,
      deviceId: body.terminalId,
    }).catch(console.error)

    // If committed, also emit order events for terminals listening to order changes
    if (isCommitted) {
      void emitOrderEvent(locationId, check.orderId as string, 'COMP_VOID_APPLIED', {
        lineItemId: itemId,
        action: body.action,
        reason: body.reason ?? null,
        employeeId: body.employeeId,
        approvedById: body.approvedById ?? null,
      }).catch(console.error)
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'item_updated',
        orderId: check.orderId as string,
      }).catch(console.error)
    }

    return ok({ id: itemId, status: newStatus, action: body.action })
  } catch (error) {
    console.error('Failed to comp/void check item:', error)
    return err('Failed to comp/void check item', 500)
  }
})
