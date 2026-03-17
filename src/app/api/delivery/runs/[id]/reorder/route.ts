import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { dispatchRunEvent } from '@/lib/delivery/dispatch-events'

export const dynamic = 'force-dynamic'

/**
 * POST /api/delivery/runs/[id]/reorder — Reorder stops mid-run
 *
 * Body: { orderSequence: [{ orderId, sequence }] }
 *
 * Delivered/arrived stops are LOCKED and cannot be reordered.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { orderSequence } = body

    if (!Array.isArray(orderSequence) || orderSequence.length === 0) {
      return NextResponse.json(
        { error: 'orderSequence must be a non-empty array of {orderId, sequence}' },
        { status: 400 }
      )
    }

    // Validate sequences are unique positive integers starting from 1
    const sequences = orderSequence.map((s: any) => s.sequence)
    const uniqueSequences = new Set(sequences)
    if (uniqueSequences.size !== sequences.length) {
      return NextResponse.json({ error: 'Duplicate sequence numbers' }, { status: 400 })
    }
    const sorted = [...sequences].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        return NextResponse.json(
          { error: 'Sequences must be consecutive integers starting from 1' },
          { status: 400 }
        )
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Fetch the run
      const runs: any[] = await tx.$queryRawUnsafe(
        `SELECT * FROM "DeliveryRun" WHERE id = $1 AND "locationId" = $2 FOR UPDATE`,
        id,
        locationId,
      )

      if (!runs.length) {
        throw new Error('Run not found')
      }

      const run = runs[0]

      // Run must not be in terminal state
      if (['completed', 'returned', 'cancelled'].includes(run.status)) {
        throw new Error(`Cannot reorder stops on a '${run.status}' run`)
      }

      // Fetch all orders in this run
      const runOrders: any[] = await tx.$queryRawUnsafe(
        `SELECT id, status, "runSequence" FROM "DeliveryOrder"
         WHERE "runId" = $1 AND "locationId" = $2
         FOR UPDATE`,
        id,
        locationId,
      )

      const runOrderIds = new Set(runOrders.map(o => o.id))
      const requestedIds = orderSequence.map((s: any) => s.orderId)

      // Validate all orderIds belong to this run
      for (const orderId of requestedIds) {
        if (!runOrderIds.has(orderId)) {
          throw new Error(`Order ${orderId} does not belong to this run`)
        }
      }

      // Validate all run orders are accounted for
      if (requestedIds.length !== runOrders.length) {
        throw new Error(
          `Expected ${runOrders.length} orders in sequence, got ${requestedIds.length}. All orders in the run must be included.`
        )
      }

      // Validate: delivered/arrived stops are LOCKED (position cannot change)
      const lockedStatuses = ['delivered', 'arrived']
      for (const entry of orderSequence) {
        const order = runOrders.find(o => o.id === entry.orderId)
        if (order && lockedStatuses.includes(order.status)) {
          // The locked order must retain its current sequence position
          if (order.runSequence !== entry.sequence) {
            throw new Error(
              `Order ${entry.orderId} is in '${order.status}' state and cannot be reordered (locked at position ${order.runSequence})`
            )
          }
        }
      }

      // Build new orderSequence JSONB
      const newOrderSequence = orderSequence.map((entry: any) => ({
        orderId: entry.orderId,
        sequence: entry.sequence,
        estimatedArrivalAt: null, // Will be recalculated below
      }))

      // Recalculate ETAs: simple additive model (zone estimatedMinutes per remaining stop)
      // Fetch zone info for each order to get estimated delivery minutes
      const orderZones: any[] = await tx.$queryRawUnsafe(
        `SELECT d.id as "deliveryOrderId", d."zoneId",
                dz."estimatedMinutes" as "zoneMinutes"
         FROM "DeliveryOrder" d
         LEFT JOIN "DeliveryZone" dz ON dz.id = d."zoneId"
         WHERE d."runId" = $1`,
        id,
      )

      const zoneMinutesMap = new Map<string, number>()
      for (const oz of orderZones) {
        zoneMinutesMap.set(oz.deliveryOrderId, oz.zoneMinutes ?? 15) // default 15 min per stop
      }

      let cumulativeMinutes = 0
      const now = new Date()
      for (const entry of newOrderSequence) {
        const order = runOrders.find(o => o.id === entry.orderId)
        // Skip ETA for already-delivered stops
        if (order && lockedStatuses.includes(order.status)) {
          continue
        }
        const zoneMin = zoneMinutesMap.get(entry.orderId) ?? 15
        cumulativeMinutes += zoneMin
        entry.estimatedArrivalAt = new Date(now.getTime() + cumulativeMinutes * 60_000).toISOString()
      }

      // Update run's orderSequence JSONB
      await tx.$queryRawUnsafe(
        `UPDATE "DeliveryRun"
         SET "orderSequence" = $1::jsonb, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $2 AND "locationId" = $3`,
        JSON.stringify(newOrderSequence),
        id,
        locationId,
      )

      // Update each DeliveryOrder.runSequence
      for (const entry of orderSequence) {
        await tx.$queryRawUnsafe(
          `UPDATE "DeliveryOrder"
           SET "runSequence" = $1, "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = $2 AND "runId" = $3`,
          entry.sequence,
          entry.orderId,
          id,
        )
      }

      // Fetch updated run
      const updatedRun: any[] = await tx.$queryRawUnsafe(
        `SELECT * FROM "DeliveryRun" WHERE id = $1 AND "locationId" = $2`,
        id,
        locationId,
      )

      return { run: updatedRun[0], previousSequence: run.orderSequence, newSequence: newOrderSequence }
    })

    // Write audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'run_reorder',
      runId: id,
      employeeId: actor.employeeId ?? 'unknown',
      previousValue: { orderSequence: result.previousSequence },
      newValue: { orderSequence: result.newSequence },
    }).catch(console.error)

    // Fire socket events
    void dispatchRunEvent(locationId, 'delivery:run_created', result.run).catch(console.error)

    return NextResponse.json({
      run: result.run,
      message: 'Stop order updated',
    })
  } catch (error: any) {
    console.error('[Delivery/Runs/Reorder] POST error:', error)
    const message = error?.message || 'Failed to reorder stops'
    if (
      message.includes('not found') ||
      message.includes('does not belong') ||
      message.includes('cannot be reordered') ||
      message.includes('Cannot reorder') ||
      message.includes('Expected')
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to reorder stops' }, { status: 500 })
  }
})
