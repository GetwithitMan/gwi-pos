/**
 * Create Reservation — canonical entry point for both admin and public booking
 *
 * Flow: customer match → advisory lock → availability re-check → serviceDate →
 * deposit rules snapshot → initial state → create row + audit event (same tx) →
 * commit → socket emit → confirmation (fire-and-forget)
 */

import crypto from 'crypto'
import type { PrismaClient } from '@prisma/client'
import type { ReservationSettings, DepositRules, ReservationMessageTemplates } from '@/lib/settings'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'

import { findOrCreateCustomer, isBlacklisted } from './customer-matcher'
import { evaluateDepositRequired, snapshotDepositRules, generateDepositToken } from './deposit-rules'
import { checkSlotAvailability, type OperatingHours } from './availability'
import { suggestTables } from './table-suggestion'
import { acquireReservationLocks, hashToLockKey } from './advisory-lock'
import { getServiceDate } from './service-date'
import { parseTimeToMinutes } from './service-date'
import { sendReservationNotification } from './notifications'
import type { Actor, SourceType } from './state-machine'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateReservationParams {
  locationId: string
  guestName: string
  guestPhone?: string | null
  guestEmail?: string | null
  partySize: number
  reservationDate: string         // YYYY-MM-DD
  reservationTime: string         // HH:MM
  duration?: number               // minutes, default from settings
  specialRequests?: string | null
  internalNotes?: string | null
  occasion?: string | null
  dietaryRestrictions?: string | null
  sectionPreference?: string | null
  source?: SourceType
  externalId?: string | null
  smsOptIn?: boolean
  tags?: string[]
  tableId?: string | null         // pre-assigned table (staff pick)
  bottleServiceTierId?: string | null
  idempotencyKey?: string | null
  forceBook?: boolean             // manager override: skip availability + blacklist
  actor: Actor
  db: PrismaClient
  settings: ReservationSettings
  depositRules: DepositRules
  templates: ReservationMessageTemplates
  operatingHours?: OperatingHours | null
  timezone: string                // e.g. "America/New_York"
  venueInfo: {
    name: string
    phone?: string
    address?: string
    email?: string
    slug: string
    baseUrl: string
  }
}

export interface CreateReservationResult {
  reservation: any
  customer: any
  created: boolean                // true if customer was newly created
  depositRequired: boolean
  depositToken?: string
  depositExpiresAt?: Date
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function createReservationWithRules(
  params: CreateReservationParams
): Promise<CreateReservationResult> {
  const {
    locationId,
    guestName,
    guestPhone,
    guestEmail,
    partySize,
    reservationDate,
    reservationTime,
    duration,
    specialRequests,
    internalNotes,
    occasion,
    dietaryRestrictions,
    sectionPreference,
    source = 'staff',
    externalId,
    smsOptIn,
    tags,
    tableId,
    bottleServiceTierId,
    idempotencyKey,
    forceBook,
    actor,
    db,
    settings,
    depositRules,
    templates,
    operatingHours,
    timezone,
    venueInfo,
  } = params

  const turnTime = duration || settings.defaultTurnTimeMinutes
  const slotMinutes = parseTimeToMinutes(reservationTime)

  // ── Step 0: Customer match (BEFORE lock to minimize hold time) ──
  const { customer, created: customerCreated } = await findOrCreateCustomer({
    phone: guestPhone,
    email: guestEmail,
    name: guestName,
    locationId,
    db,
  })

  // ── Step 0b: Blacklist check ──
  if (!forceBook && isBlacklisted(customer)) {
    throw new CreateReservationError(
      'Guest is blacklisted and cannot make reservations',
      'BLACKLISTED'
    )
  }

  // ── Step 1: Deposit evaluation (before lock, pure logic) ──
  const depositEval = evaluateDepositRequired({
    partySize,
    reservationDate,
    reservationTime,
    isOnlineBooking: source === 'online',
    rules: depositRules,
  })
  const depositSnapshot = depositEval.required
    ? snapshotDepositRules(depositRules, depositEval)
    : null

  // ── Step 2: Interactive transaction with advisory lock ──
  const result = await db.$transaction(async (tx: any) => {
    // 2a. Idempotency check — acquire advisory lock on idempotency key FIRST to prevent race
    if (idempotencyKey) {
      const idempKeyLock = hashToLockKey('idem:' + idempotencyKey)
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock($1::bigint)`,
        idempKeyLock.toString()
      )

      const existing = await tx.reservationIdempotencyKey.findUnique({
        where: { key: idempotencyKey },
        include: { reservation: true },
      })
      if (existing) {
        return { reservation: existing.reservation, idempotent: true }
      }
    }

    // 2b. Advisory lock on time slots
    await acquireReservationLocks(tx, locationId, reservationDate, slotMinutes, turnTime)

    // 2c. Availability re-check (under lock)
    if (!forceBook) {
      const avail = await checkSlotAvailability({
        locationId,
        date: reservationDate,
        time: reservationTime,
        partySize,
        durationMinutes: turnTime,
        db: tx,
        settings,
        operatingHours,
      })

      if (!avail.available) {
        throw new CreateReservationError(
          avail.reason || 'Slot is no longer available',
          'SLOT_UNAVAILABLE'
        )
      }
    }

    // 2d. Table assignment — use provided tableId or auto-suggest best fit
    let assignedTableId = tableId || null
    if (!assignedTableId) {
      const suggestions = await suggestTables({
        locationId,
        date: reservationDate,
        time: reservationTime,
        partySize,
        durationMinutes: turnTime,
        db: tx,
        settings,
        operatingHours,
        sectionPreference: sectionPreference || undefined,
      })

      if (suggestions.length > 0) {
        assignedTableId = suggestions[0].table.id
      }
    }

    // 2e. Service date calculation
    const reservationDateTime = new Date(`${reservationDate}T${reservationTime}:00`)
    const serviceDate = getServiceDate(reservationDateTime, timezone, settings.serviceEndHour)

    // 2f. Determine initial status
    let initialStatus: 'pending' | 'confirmed'
    let holdExpiresAt: Date | null = null

    if (depositEval.required) {
      initialStatus = 'pending'
      holdExpiresAt = new Date(Date.now() + depositRules.expirationMinutes * 60 * 1000)
    } else if (settings.autoConfirmNoDeposit) {
      initialStatus = 'confirmed'
    } else {
      initialStatus = 'pending'
    }

    // If forceBook by staff, always confirm
    if (forceBook && actor.type === 'staff') {
      initialStatus = 'confirmed'
      holdExpiresAt = null
    }

    // 2g. Generate manage token
    const manageToken = crypto.randomUUID()

    // 2h. Create reservation
    const now = new Date()
    const reservation = await tx.reservation.create({
      data: {
        locationId,
        guestName,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        partySize,
        reservationDate: new Date(reservationDate + 'T00:00:00Z'),
        reservationTime,
        duration: turnTime,
        tableId: assignedTableId,
        status: initialStatus,
        specialRequests: specialRequests || null,
        internalNotes: internalNotes || null,
        customerId: customer.id,
        occasion: occasion || null,
        dietaryRestrictions: dietaryRestrictions || null,
        source,
        externalId: externalId || null,
        sectionPreference: sectionPreference || null,
        manageToken,
        tags: tags || [],
        serviceDate: new Date(serviceDate + 'T00:00:00Z'),
        holdExpiresAt,
        depositStatus: depositEval.required ? 'pending' : 'not_required',
        depositAmountCents: depositEval.required ? depositEval.amount : null,
        depositRulesSnapshot: depositSnapshot ? JSON.parse(JSON.stringify(depositSnapshot)) : null,
        depositRequired: depositEval.required,
        smsOptInSnapshot: smsOptIn ?? null,
        statusUpdatedAt: now,
        confirmedAt: initialStatus === 'confirmed' ? now : null,
        bottleServiceTierId: bottleServiceTierId || null,
        createdBy: actor.id || null,
        sourceMetadata: externalId ? { externalId } : null,
      },
    })

    // 2i. Write 'created' audit event (same transaction)
    await tx.reservationEvent.create({
      data: {
        locationId,
        reservationId: reservation.id,
        eventType: 'created',
        actor: actor.type,
        actorId: actor.id || null,
        details: {
          partySize,
          reservationDate,
          reservationTime,
          duration: turnTime,
          source,
          tableId: assignedTableId,
          depositRequired: depositEval.required,
          depositAmountCents: depositEval.required ? depositEval.amount : undefined,
          initialStatus,
          forceBook: forceBook || false,
        },
      },
    })

    // 2j. Idempotency key
    if (idempotencyKey) {
      await tx.reservationIdempotencyKey.create({
        data: {
          key: idempotencyKey,
          reservationId: reservation.id,
          source,
        },
      })
    }

    // 2k. If table assigned, also create ReservationTable junction row
    if (assignedTableId) {
      await tx.reservationTable.create({
        data: {
          reservationId: reservation.id,
          tableId: assignedTableId,
        },
      })
    }

    return { reservation, idempotent: false }
  }, { timeout: 10000 })

  // If idempotent return, just return existing reservation
  if (result.idempotent) {
    return {
      reservation: result.reservation,
      customer,
      created: customerCreated,
      depositRequired: false,
    }
  }

  const reservation = result.reservation

  // ── Step 3: Post-commit — socket dispatch ──
  void dispatchReservationChanged(locationId, {
    reservationId: reservation.id,
    action: 'created',
    reservation,
  }).catch(console.error)

  // ── Step 4: Post-commit — generate deposit token if needed ──
  let depositToken: string | undefined
  let depositExpiresAt: Date | undefined

  if (depositEval.required) {
    const tokenResult = await generateDepositToken(
      reservation.id,
      depositRules.expirationMinutes,
      db
    )
    depositToken = tokenResult.token
    depositExpiresAt = tokenResult.expiresAt
  }

  // ── Step 5: Post-commit — send confirmation (fire-and-forget) ──
  const templateKey = depositEval.required ? 'depositRequest' : 'confirmation'
  void sendReservationNotification({
    reservation: {
      ...reservation,
      customer,
    },
    templateKey,
    db,
    templates,
    venueInfo,
  }).catch(console.error)

  return {
    reservation,
    customer,
    created: customerCreated,
    depositRequired: depositEval.required,
    depositToken,
    depositExpiresAt,
  }
}

// ─── Error ──────────────────────────────────────────────────────────────────

export class CreateReservationError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'CreateReservationError'
  }
}
