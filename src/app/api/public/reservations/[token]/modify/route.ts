import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_RESERVATION_SETTINGS, DEFAULT_DEPOSIT_RULES } from '@/lib/settings'
import { repriceAndRevalidate } from '@/lib/reservations/revalidate'
import { createRateLimiter } from '@/lib/rate-limiter'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('public-reservations-modify')

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/[token]/modify — Guest self-service modify
 * MVP scope: date/time changes only. No party size changes.
 * Body: { date?: string, time?: string }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`modify:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { token } = params
    const body = await request.json()
    const { date, time } = body

    if (!date && !time) {
      return err('At least date or time must be provided')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found')
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const resSetting = settings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS
    const depositRules = settings.depositRules ?? DEFAULT_DEPOSIT_RULES

    // Check if guest self-service is allowed (online booking = guest can manage)
    if (!resSetting.allowOnlineBooking) {
      return NextResponse.json({
        error: 'Online modification is not available. Please call to modify your reservation.',
        callVenue: true,
      }, { status: 403 })
    }

    const reservation = await db.reservation.findFirst({
      where: { manageToken: token, locationId },
    })

    if (!reservation) {
      return notFound('Reservation not found')
    }

    const terminalStatuses = ['completed', 'cancelled', 'no_show']
    if (terminalStatuses.includes(reservation.status)) {
      return err(`Cannot modify a ${reservation.status} reservation`)
    }

    // TODO: Load operating hours
    const operatingHours = { open: '11:00', close: '23:00' }

    // Revalidate proposed changes
    const validation = await repriceAndRevalidate({
      reservationId: reservation.id,
      locationId,
      proposed: {
        date: date || undefined,
        time: time || undefined,
      },
      current: {
        reservationDate: reservation.reservationDate,
        reservationTime: reservation.reservationTime,
        partySize: reservation.partySize,
        duration: reservation.duration,
        tableId: reservation.tableId,
        depositStatus: reservation.depositStatus,
        depositAmountCents: reservation.depositAmountCents,
        status: reservation.status,
      },
      actor: { type: 'guest' },
      db,
      settings: resSetting,
      depositRules,
      operatingHours,
    })

    if (!validation.allowed) {
      return NextResponse.json({
        error: 'Modification not allowed',
        reasons: validation.reasons,
        warnings: validation.warnings,
        staffOverrideRequired: validation.staffOverrideRequired,
      }, { status: 400 })
    }

    // Apply the modification
    const updateData: Record<string, any> = {
      updatedAt: new Date(),
      lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
    }
    if (date) {
      updateData.reservationDate = new Date(date + 'T00:00:00Z')
    }
    if (time) {
      updateData.reservationTime = time
    }

    const updated = await db.reservation.update({
      where: { id: reservation.id },
      data: updateData,
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'updated', entityId: reservation.id })
    void pushUpstream()

    // Log modification event
    void db.reservationEvent.create({
      data: {
        locationId,
        reservationId: reservation.id,
        eventType: 'modified',
        actor: 'guest',
        details: {
          previousDate: reservation.reservationDate,
          previousTime: reservation.reservationTime,
          newDate: date || undefined,
          newTime: time || undefined,
          depositDelta: validation.depositDelta,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
      id: updated.id,
      status: updated.status,
      reservationDate: updated.reservationDate,
      reservationTime: updated.reservationTime,
      warnings: validation.warnings,
      depositDelta: validation.depositDelta,
      message: 'Reservation updated successfully',
    })
  } catch (error) {
    console.error('[Public Modify] Error:', error)
    return err('Failed to modify reservation', 500)
  }
})
