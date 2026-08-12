import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, resolveLocationId } from '@/lib/check-events'
import { dispatchCheckOpened, dispatchChecksListChanged } from '@/lib/socket-dispatch/check-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { err, created } from '@/lib/api-response'

// ── Zod schema for POST /api/checks ────────────────────────────────
const OpenCheckSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  locationId: z.string().min(1, 'locationId is required'),
  employeeId: z.string().min(1, 'employeeId is required'),
  terminalId: z.string().min(1, 'terminalId is required'),
  orderType: z.enum(['dine_in', 'takeout', 'delivery', 'bar_tab']).default('dine_in'),
  tableId: z.string().optional(),
  tabName: z.string().max(100).optional(),
  guestCount: z.number().int().min(1).default(1),
  isBottleService: z.boolean().default(false),
  bottleServiceTierId: z.string().optional(),
})

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const parseResult = OpenCheckSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId (body is authoritative, fall back to context)
    const locationId = await resolveLocationId(request, body.locationId)
    if (!locationId) return err('locationId is required', 400)

    // Auth
    const auth = await requirePermission(body.employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return created(existing)

    // Create check + emit events + record command in one transaction
    const result = await db.$transaction(async (tx) => {
      // ── Table exclusivity guard ─────────────────────────────────────
      // Prevent two terminals opening separate drafts on the same table.
      if (body.tableId) {
        // Advisory lock serializes check creation per table within this txn
        const lockKey = Math.abs(body.tableId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0))
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`

        const existingCheck = await tx.check.findFirst({
          where: {
            locationId,
            tableId: body.tableId,
            status: { in: ['draft', 'committed', 'paid'] },
            deletedAt: null,
          },
        })
        if (existingCheck) {
          // Return the existing check instead of creating a new one
          // (handles the race where two terminals tap the same table simultaneously)
          const resultData = {
            id: existingCheck.id,
            locationId: existingCheck.locationId,
            status: existingCheck.status,
            orderNumber: existingCheck.orderNumber,
            tableId: existingCheck.tableId,
            employeeId: existingCheck.employeeId,
            guestCount: existingCheck.guestCount,
            orderType: existingCheck.orderType,
            terminalId: existingCheck.terminalId,
            existing: true,
          }
          await tx.processedCommand.create({
            data: { commandId: body.commandId, resultJson: JSON.stringify(resultData) },
          })
          return { check: resultData as typeof resultData & Record<string, unknown>, openedEvent: null, leaseEvent: null }
        }
      }

      const newCheck = await tx.check.create({
        data: {
          locationId,
          employeeId: body.employeeId,
          orderType: body.orderType,
          tableId: body.tableId ?? null,
          tabName: body.tabName ?? null,
          guestCount: body.guestCount,
          terminalId: body.terminalId,
          leaseAcquiredAt: new Date(),
          leaseLastHeartbeatAt: new Date(),
          isBottleService: body.isBottleService,
          bottleServiceTierId: body.bottleServiceTierId ?? null,
        },
      })

      const openedPayload = {
        locationId,
        employeeId: body.employeeId,
        orderType: body.orderType,
        tableId: body.tableId ?? null,
        tabName: body.tabName ?? null,
        guestCount: body.guestCount,
        terminalId: body.terminalId,
      }
      const openedEvent = await emitCheckEventInTx(tx, locationId, newCheck.id, 'CHECK_OPENED', openedPayload, { commandId: body.commandId })

      const leasePayload = {
        terminalId: body.terminalId,
        employeeName: auth.employee?.displayName ?? auth.employee?.firstName ?? body.employeeId,
      }
      const leaseEvent = await emitCheckEventInTx(tx, locationId, newCheck.id, 'CHECK_LEASE_ACQUIRED', leasePayload, { commandId: body.commandId })

      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify(newCheck),
        },
      })

      return { check: newCheck, openedEvent, leaseEvent, openedPayload, leasePayload }
    })

    // Socket dispatch — fire-and-forget AFTER txn (best-effort)
    void dispatchCheckOpened(locationId, result.check.id, {
      employeeId: body.employeeId,
      orderType: body.orderType,
      tableId: body.tableId,
      terminalId: body.terminalId,
    })
    void dispatchChecksListChanged(locationId)

    // Broadcast check:event for each event emitted in the txn
    if (result.openedEvent) {
      void emitToLocation(locationId, 'check:event', {
        eventId: result.openedEvent.eventId,
        checkId: result.check.id,
        serverSequence: result.openedEvent.serverSequence,
        type: 'CHECK_OPENED',
        payload: result.openedPayload,
        commandId: body.commandId,
        deviceId: body.terminalId,
      }).catch(console.error)
    }
    if (result.leaseEvent) {
      void emitToLocation(locationId, 'check:event', {
        eventId: result.leaseEvent.eventId,
        checkId: result.check.id,
        serverSequence: result.leaseEvent.serverSequence,
        type: 'CHECK_LEASE_ACQUIRED',
        payload: result.leasePayload,
        commandId: body.commandId,
        deviceId: body.terminalId,
      }).catch(console.error)
    }

    return created(result.check)
  } catch (error) {
    console.error('Failed to open check:', error)
    return err('Failed to open check', 500)
  }
})
