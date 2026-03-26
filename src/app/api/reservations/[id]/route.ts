import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { repriceAndRevalidate } from '@/lib/reservations/revalidate'
import { transition, TransitionError } from '@/lib/reservations/state-machine'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { offerSlotToWaitlist } from '@/lib/reservations/waitlist-bridge'
import type { OperatingHours } from '@/lib/reservations/availability'

// GET - Single reservation with full details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const reservation = await db.reservation.findUnique({
      where: { id },
      include: {
        table: {
          select: { id: true, name: true, capacity: true, section: { select: { id: true, name: true } } },
        },
        customer: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, email: true,
            noShowCount: true, isBlacklisted: true, blacklistOverrideUntil: true,
            notes: true, allergies: true, tags: true,
          },
        },
        bottleServiceTier: {
          select: { id: true, name: true, color: true, depositAmount: true, minimumSpend: true },
        },
        reservationTables: { select: { tableId: true, table: { select: { id: true, name: true, capacity: true } } } },
      },
    })

    if (!reservation || reservation.locationId !== locationId) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { reservation } })
  } catch (error) {
    console.error('[reservations/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reservation' }, { status: 500 })
  }
})

// PUT - Update reservation (uses revalidation engine for structural changes)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Load current reservation with location settings
    const current = await db.reservation.findUnique({
      where: { id },
      include: { location: { select: { settings: true, timezone: true } } },
    })

    if (!current || current.locationId !== callerLocationId) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, current.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    const locationSettings = current.location as any
    const settings = parseSettings(locationSettings.settings)
    const resSettings = settings.reservationSettings!
    const depRules = settings.depositRules!

    // Handle status transitions via state machine
    if (body.status !== undefined && body.status !== current.status) {
      try {
        const updated = await db.$transaction(async (tx: any) => {
          return transition({
            reservationId: id,
            to: body.status,
            actor: { type: 'staff', id: actor.employeeId || undefined },
            reason: body.cancelReason || body.reason,
            overrideType: body.overrideType,
            db: tx,
            locationId: current.locationId,
          })
        })

        // Post-commit: socket dispatch
        void dispatchReservationChanged(current.locationId, {
          reservationId: id, action: body.status, reservation: updated,
        }).catch(console.error)

        void notifyDataChanged({ locationId: current.locationId, domain: 'reservations', action: 'updated', entityId: id })
        void pushUpstream()

        return NextResponse.json({ data: { reservation: updated } })
      } catch (err) {
        if (err instanceof TransitionError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
        }
        throw err
      }
    }

    // Determine proposed structural changes
    const proposed: Record<string, any> = {}
    if (body.reservationDate !== undefined) proposed.date = body.reservationDate
    if (body.reservationTime !== undefined) proposed.time = body.reservationTime
    if (body.partySize !== undefined) proposed.partySize = body.partySize
    if (body.duration !== undefined) proposed.duration = body.duration
    if (body.tableId !== undefined) proposed.tableId = body.tableId
    if (body.sectionPreference !== undefined) proposed.sectionPreference = body.sectionPreference

    const hasStructuralChange = Object.keys(proposed).length > 0

    // Revalidate structural changes
    if (hasStructuralChange) {
      const effectiveDate = proposed.date || current.reservationDate.toISOString().split('T')[0]
      const dayOfWeek = new Date(effectiveDate + 'T12:00:00').getDay()
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const hoursConfig = (settings as any)?.operatingHours || {}
      const hours = hoursConfig[dayNames[dayOfWeek]] as OperatingHours | null | undefined

      const validation = await repriceAndRevalidate({
        reservationId: id,
        locationId: current.locationId,
        proposed,
        current: {
          reservationDate: current.reservationDate,
          reservationTime: current.reservationTime,
          partySize: current.partySize,
          duration: current.duration,
          tableId: current.tableId,
          depositStatus: current.depositStatus,
          depositAmountCents: current.depositAmountCents,
          status: current.status,
        },
        actor: {
          type: actor.fromSession ? 'staff' : 'guest',
          id: actor.employeeId || undefined,
        },
        db,
        settings: resSettings,
        depositRules: depRules,
        operatingHours: hours || null,
      })

      if (!validation.allowed && !body.forceOverride) {
        return NextResponse.json({
          error: 'Modification not allowed',
          reasons: validation.reasons,
          warnings: validation.warnings,
          staffOverrideRequired: validation.staffOverrideRequired,
          depositDelta: validation.depositDelta,
          refundAmountCents: validation.refundAmountCents,
        }, { status: 422 })
      }
    }

    // Build update data
    const updateData: Record<string, any> = {}

    // Structural fields
    if (body.reservationDate !== undefined) updateData.reservationDate = new Date(body.reservationDate + 'T00:00:00Z')
    if (body.reservationTime !== undefined) updateData.reservationTime = body.reservationTime
    if (body.partySize !== undefined) updateData.partySize = body.partySize
    if (body.duration !== undefined) updateData.duration = body.duration
    if (body.tableId !== undefined) updateData.tableId = body.tableId || null

    // Info fields — guestName (fix old customerName mismatch)
    if (body.guestName !== undefined) updateData.guestName = body.guestName
    if (body.customerName !== undefined) updateData.guestName = body.customerName
    if (body.guestPhone !== undefined) updateData.guestPhone = body.guestPhone
    if (body.customerPhone !== undefined) updateData.guestPhone = body.customerPhone
    if (body.guestEmail !== undefined) updateData.guestEmail = body.guestEmail
    if (body.customerEmail !== undefined) updateData.guestEmail = body.customerEmail
    if (body.specialRequests !== undefined) updateData.specialRequests = body.specialRequests
    if (body.internalNotes !== undefined) updateData.internalNotes = body.internalNotes
    if (body.occasion !== undefined) updateData.occasion = body.occasion
    if (body.dietaryRestrictions !== undefined) updateData.dietaryRestrictions = body.dietaryRestrictions
    if (body.sectionPreference !== undefined) updateData.sectionPreference = body.sectionPreference
    if (body.source !== undefined) updateData.source = body.source
    if (body.tags !== undefined) updateData.tags = body.tags
    if (body.customerId !== undefined) updateData.customerId = body.customerId || null
    if (body.bottleServiceTierId !== undefined) updateData.bottleServiceTierId = body.bottleServiceTierId || null
    updateData.lastMutatedBy = process.env.VERCEL ? 'cloud' : 'local'

    const updated = await db.reservation.update({
      where: { id },
      data: updateData,
      include: {
        table: { select: { id: true, name: true, capacity: true } },
        customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        bottleServiceTier: { select: { id: true, name: true, color: true, depositAmount: true, minimumSpend: true } },
      },
    })

    // Write modification audit event
    await db.reservationEvent.create({
      data: {
        locationId: current.locationId,
        reservationId: id,
        eventType: 'modified',
        actor: actor.fromSession ? 'staff' : 'guest',
        actorId: actor.employeeId,
        details: { changes: Object.keys(updateData) },
      },
    })

    // Socket dispatch
    void dispatchReservationChanged(current.locationId, {
      reservationId: id,
      action: 'modified',
      reservation: updated,
    }).catch(console.error)

    void notifyDataChanged({ locationId: current.locationId, domain: 'reservations', action: 'updated', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { reservation: updated } })
  } catch (error) {
    console.error('[reservations/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
})

// DELETE - Cancel/delete a reservation (uses state machine for cancel)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const cancel = searchParams.get('cancel') === 'true'

    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const reservation = await db.reservation.findUnique({ where: { id } })
    if (!reservation || reservation.locationId !== callerLocationId) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    if (cancel) {
      const actor = await getActorFromRequest(request)
      try {
        await db.$transaction(async (tx: any) => {
          return transition({
            reservationId: id,
            to: 'cancelled',
            actor: {
              type: actor.fromSession ? 'staff' : 'guest',
              id: actor.employeeId || undefined,
            },
            reason: searchParams.get('reason') || undefined,
            db: tx,
            locationId: reservation.locationId,
          })
        })

        // Post-commit: offer slot to waitlist (fire-and-forget)
        void (async () => {
          const location = await db.location.findUnique({
            where: { id: reservation.locationId },
            select: { name: true, phone: true, address: true, settings: true },
          })
          if (!location) return
          const settings = parseSettings(location.settings)
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006'
          await offerSlotToWaitlist({
            cancelledReservation: {
              id,
              locationId: reservation.locationId,
              guestName: reservation.guestName,
              reservationDate: reservation.reservationDate,
              reservationTime: reservation.reservationTime,
              partySize: reservation.partySize,
              tableId: reservation.tableId,
              duration: reservation.duration ?? 90,
              sectionPreference: reservation.sectionPreference,
            },
            db,
            templates: settings.reservationTemplates,
            venueInfo: {
              name: location.name,
              phone: location.phone || undefined,
              address: location.address || undefined,
              slug: '',
              baseUrl,
            },
          })
        })().catch(console.error)

        void notifyDataChanged({ locationId: reservation.locationId, domain: 'reservations', action: 'deleted', entityId: id })
        void pushUpstream()

        return NextResponse.json({ data: { success: true, message: 'Reservation cancelled' } })
      } catch (err) {
        if (err instanceof TransitionError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
        }
        throw err
      }
    }

    await db.reservation.update({ where: { id }, data: { deletedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' } })

    void notifyDataChanged({ locationId: reservation.locationId, domain: 'reservations', action: 'deleted', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[reservations/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete reservation' }, { status: 500 })
  }
})
