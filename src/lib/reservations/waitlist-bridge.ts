/**
 * Waitlist Bridge — connect cancelled reservations to waitlist guests
 *
 * When a reservation is cancelled:
 *   1. Check if reservation is > 30 min away (don't bother for imminent slots)
 *   2. Find first-in-queue waitlist entry with matching party size
 *   3. Create a new reservation for the waitlist guest (status: pending, 10-min claim window)
 *   4. Send SMS with claim link
 *   5. If unclaimed after 10 min, auto-cancel and offer to next in line (handled by cron)
 */

import crypto from 'crypto'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { parseTimeToMinutes } from './service-date'
import { transition } from './state-machine'
import { findOrCreateCustomer } from './customer-matcher'
import { sendReservationNotification, type TemplateKey } from './notifications'
import { dispatchReservationChanged, dispatchWaitlistChanged } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('reservations')

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WaitlistBridgeParams {
  cancelledReservation: {
    id: string
    locationId: string
    guestName: string
    reservationDate: Date
    reservationTime: string
    partySize: number
    tableId: string | null
    duration: number
    sectionPreference: string | null
  }
  db: PrismaClient | any
  templates: any // ReservationMessageTemplates
  venueInfo: {
    name: string
    phone?: string
    address?: string
    slug: string
    baseUrl: string
  }
  claimWindowMinutes?: number // default 10
}

export interface WaitlistBridgeResult {
  offered: boolean
  waitlistEntryId?: string
  offeredReservationId?: string
  reason?: string
}

// ─── Main Bridge Function ───────────────────────────────────────────────────

export async function offerSlotToWaitlist(
  params: WaitlistBridgeParams
): Promise<WaitlistBridgeResult> {
  const {
    cancelledReservation: rez,
    db,
    templates,
    venueInfo,
    claimWindowMinutes = 10,
  } = params

  // Guard: don't offer if reservation is < 30 min away
  const now = new Date()
  const rezMinutes = parseTimeToMinutes(rez.reservationTime)
  const rezDate = new Date(rez.reservationDate)
  rezDate.setHours(0, 0, 0, 0)
  const rezTimestamp = new Date(rezDate.getTime() + rezMinutes * 60_000)

  const minutesUntil = (rezTimestamp.getTime() - now.getTime()) / 60_000
  if (minutesUntil < 30) {
    return { offered: false, reason: 'Reservation is less than 30 minutes away' }
  }

  // Find first-in-queue waitlist entry matching party size
  // Party size match: waitlist partySize must be <= cancelled reservation partySize
  const waitlistMatch: any[] = await db.$queryRaw(Prisma.sql`
    SELECT id, "customerName", "partySize", phone, notes
    FROM "WaitlistEntry"
    WHERE "locationId" = ${rez.locationId}
      AND status IN ('waiting', 'notified')
      AND "partySize" <= ${rez.partySize}
    ORDER BY position ASC, "createdAt" ASC
    LIMIT 1
  `)

  if (waitlistMatch.length === 0) {
    return { offered: false, reason: 'No matching waitlist entries' }
  }

  const entry = waitlistMatch[0]

  if (!entry.phone) {
    return { offered: false, reason: 'Waitlist entry has no phone number for SMS' }
  }

  // Create a pending reservation for the waitlist guest with claim window
  const holdExpiresAt = new Date(now.getTime() + claimWindowMinutes * 60_000)
  const manageToken = crypto.randomBytes(16).toString('hex')

  // Match or create customer so no-show tracking and history work
  const { customer } = await findOrCreateCustomer({
    phone: entry.phone,
    email: null,
    name: entry.customerName,
    locationId: rez.locationId,
    db,
  })

  // Wrap all writes in a single transaction for atomicity
  const newReservation = await db.$transaction(async (tx: any) => {
    const reservation = await tx.reservation.create({
      data: {
        locationId: rez.locationId,
        guestName: entry.customerName,
        guestPhone: entry.phone,
        partySize: entry.partySize,
        reservationDate: rez.reservationDate,
        reservationTime: rez.reservationTime,
        duration: rez.duration,
        tableId: rez.tableId,
        sectionPreference: rez.sectionPreference,
        customerId: customer.id,
        status: 'pending',
        source: 'waitlist',
        holdExpiresAt,
        manageToken,
        specialRequests: entry.notes || null,
      },
      include: {
        table: { select: { id: true, name: true } },
      },
    })

    // Write audit event
    await tx.reservationEvent.create({
      data: {
        locationId: rez.locationId,
        reservationId: reservation.id,
        eventType: 'slot_offered',
        actor: 'system',
        details: {
          sourceReservationId: rez.id,
          waitlistEntryId: entry.id,
          claimWindowMinutes,
          holdExpiresAt: holdExpiresAt.toISOString(),
        },
      },
    })

    // Update waitlist entry status to 'notified'
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WaitlistEntry"
      SET status = 'notified', "notifiedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${entry.id} AND "locationId" = ${rez.locationId}
    `)

    return reservation
  })

  // Fire-and-forget: send notification via waitlistPromoted template
  void sendReservationNotification({
    reservation: {
      ...newReservation,
      manageToken,
      holdMinutes: claimWindowMinutes,
    },
    templateKey: 'waitlistPromoted' as TemplateKey,
    db,
    templates,
    venueInfo,
    channels: ['sms'],
  }).catch((err) => log.error({ err }, 'operation failed'))

  // Socket dispatches
  void dispatchReservationChanged(rez.locationId, {
    reservationId: newReservation.id,
    action: 'slot_offered',
    reservation: newReservation,
  }).catch((err) => log.error({ err }, 'dispatchReservationChanged failed'))

  void dispatchWaitlistChanged(rez.locationId, {
    action: 'notified',
    entryId: entry.id,
    customerName: entry.customerName,
    partySize: entry.partySize,
  }).catch((err) => log.error({ err }, 'dispatchWaitlistChanged failed'))

  return {
    offered: true,
    waitlistEntryId: entry.id,
    offeredReservationId: newReservation.id,
  }
}

// ─── Claim Function ─────────────────────────────────────────────────────────

/**
 * Guest claims a waitlist-offered slot by visiting the manage link.
 * Transitions pending → confirmed if within claim window.
 */
export async function claimOfferedSlot(params: {
  manageToken: string
  locationId: string
  db: PrismaClient | any
}): Promise<{
  success: boolean
  reservation?: any
  error?: string
}> {
  const { manageToken, locationId, db } = params

  const reservation = await db.reservation.findFirst({
    where: {
      manageToken,
      locationId,
      source: 'waitlist',
      status: 'pending',
    },
    include: {
      table: { select: { id: true, name: true } },
    },
  })

  if (!reservation) {
    return { success: false, error: 'Reservation not found or already claimed' }
  }

  // Check claim window
  if (reservation.holdExpiresAt && new Date() > new Date(reservation.holdExpiresAt)) {
    return { success: false, error: 'Claim window has expired' }
  }

  // Wrap claim flow in a single transaction for atomicity
  const updated = await db.$transaction(async (tx: any) => {
    // Use state machine for proper transition (sets confirmedAt, statusUpdatedAt, audit event)
    const transitioned = await transition({
      reservationId: reservation.id,
      to: 'confirmed',
      actor: { type: 'guest' },
      db: tx,
      locationId,
    })

    // Clear hold window
    await tx.reservation.update({
      where: { id: reservation.id },
      data: { holdExpiresAt: null },
    })

    // Write slot_claimed audit event (distinct from the 'confirmed' event from transition)
    await tx.reservationEvent.create({
      data: {
        locationId,
        reservationId: reservation.id,
        eventType: 'slot_claimed',
        actor: 'guest',
        details: {
          claimedAt: new Date().toISOString(),
        },
      },
    })

    // Remove from waitlist (find by phone match)
    if (reservation.guestPhone) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WaitlistEntry"
        SET status = 'seated', "seatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "locationId" = ${locationId} AND phone = ${reservation.guestPhone} AND status IN ('waiting', 'notified')
      `)

      // Recalculate positions
      await tx.$executeRaw(Prisma.sql`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, "createdAt" ASC) as new_pos
          FROM "WaitlistEntry"
          WHERE "locationId" = ${locationId} AND status IN ('waiting', 'notified')
        )
        UPDATE "WaitlistEntry" w
        SET position = r.new_pos
        FROM ranked r
        WHERE w.id = r.id
      `)
    }

    // Re-fetch with table include for return value
    return await tx.reservation.findUnique({
      where: { id: reservation.id },
      include: { table: { select: { id: true, name: true } } },
    })
  })

  // Socket dispatch (post-commit)
  void dispatchReservationChanged(locationId, {
    reservationId: reservation.id,
    action: 'confirmed',
    reservation: updated,
  }).catch((err) => log.error({ err }, 'dispatchReservationChanged failed'))

  return { success: true, reservation: updated }
}
