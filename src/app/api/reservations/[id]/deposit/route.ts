import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'

// GET - Get deposit status for a reservation
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const reservation = await db.$queryRawUnsafe<Array<{
      id: string
      locationId: string
      guestName: string
      partySize: number
      reservationDate: Date
      reservationTime: string
      depositRequired: boolean
      depositAmount: string
      status: string
    }>>(
      `SELECT id, "locationId", "guestName", "partySize", "reservationDate",
              "reservationTime", "depositRequired", "depositAmount", status
       FROM "Reservation" WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      id, callerLocationId
    )

    if (!reservation.length) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const res = reservation[0]

    // Fetch all deposits for this reservation
    const deposits = await db.$queryRawUnsafe<Array<{
      id: string
      type: string
      amount: string
      paymentMethod: string
      cardLast4: string | null
      cardBrand: string | null
      status: string
      refundedAmount: string
      refundedAt: Date | null
      refundReason: string | null
      createdAt: Date
    }>>(
      `SELECT id, type, amount, "paymentMethod", "cardLast4", "cardBrand",
              status, "refundedAmount", "refundedAt", "refundReason", "createdAt"
       FROM "ReservationDeposit"
       WHERE "reservationId" = $1 AND "deletedAt" IS NULL
       ORDER BY "createdAt" ASC`,
      id
    )

    const paidAmount = deposits.reduce((sum, d) =>
      d.status === 'completed' ? sum + Number(d.amount) - Number(d.refundedAmount) : sum, 0
    )

    // Load settings to calculate refundable amount
    const location = await db.location.findUnique({
      where: { id: res.locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const depositSettings = settings.reservationDeposits

    // Calculate refundable amount based on time until reservation
    const reservationDateTime = new Date(res.reservationDate)
    const [hours, mins] = res.reservationTime.split(':').map(Number)
    reservationDateTime.setHours(hours, mins, 0, 0)

    const hoursUntilReservation = (reservationDateTime.getTime() - Date.now()) / (1000 * 60 * 60)
    const refundableBeforeHours = depositSettings?.refundableBeforeHours ?? 24
    const nonRefundablePercent = depositSettings?.nonRefundablePercent ?? 0
    const withinRefundWindow = hoursUntilReservation >= refundableBeforeHours

    const nonRefundableAmount = paidAmount * (nonRefundablePercent / 100)
    const refundableAmount = withinRefundWindow
      ? Math.max(0, paidAmount - nonRefundableAmount)
      : 0 // Outside refund window — nothing refundable

    return NextResponse.json({
      data: {
        reservationId: id,
        depositRequired: res.depositRequired,
        depositAmount: Number(res.depositAmount),
        paidAmount: Math.round(paidAmount * 100) / 100,
        refundableAmount: Math.round(refundableAmount * 100) / 100,
        nonRefundableAmount: Math.round(nonRefundableAmount * 100) / 100,
        withinRefundWindow,
        hoursUntilReservation: Math.round(hoursUntilReservation * 10) / 10,
        status: paidAmount >= Number(res.depositAmount) ? 'fully_paid' :
                paidAmount > 0 ? 'partially_paid' : 'unpaid',
        deposits: deposits.map(d => ({
          id: d.id,
          type: d.type,
          amount: Number(d.amount),
          paymentMethod: d.paymentMethod,
          cardLast4: d.cardLast4,
          cardBrand: d.cardBrand,
          status: d.status,
          refundedAmount: Number(d.refundedAmount),
          refundedAt: d.refundedAt,
          refundReason: d.refundReason,
          createdAt: d.createdAt,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to get deposit status:', error)
    return NextResponse.json({ error: 'Failed to get deposit status' }, { status: 500 })
  }
})

// POST - Record a deposit payment
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, callerLocationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    const body = await request.json()
    const { amount, paymentMethod, cardLast4, cardBrand, datacapRecordNo, datacapRefNumber, notes } = body
    const employeeId = actor.employeeId

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    if (!paymentMethod || !['cash', 'card'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Payment method must be "cash" or "card"' }, { status: 400 })
    }

    // Validate reservation exists and is not cancelled
    const reservation = await db.$queryRawUnsafe<Array<{
      id: string
      locationId: string
      depositAmount: string
      status: string
    }>>(
      `SELECT id, "locationId", "depositAmount", status
       FROM "Reservation" WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      id, callerLocationId
    )

    if (!reservation.length) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const res = reservation[0]
    if (res.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot deposit on a cancelled reservation' }, { status: 400 })
    }

    // Check existing deposits
    const existingDeposits = await db.$queryRawUnsafe<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(amount - "refundedAmount"), 0) as total
       FROM "ReservationDeposit"
       WHERE "reservationId" = $1 AND status = 'completed' AND "deletedAt" IS NULL`,
      id
    )
    const currentPaid = Number(existingDeposits[0]?.total ?? 0)
    const depositTarget = Number(res.depositAmount)

    if (depositTarget > 0 && currentPaid >= depositTarget) {
      return NextResponse.json({ error: 'Deposit already fully paid' }, { status: 400 })
    }

    // Create deposit record (use crypto UUID instead of predictable ID)
    const { randomUUID } = await import('crypto')
    const depositId = randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "ReservationDeposit" (id, "locationId", "reservationId", type, amount, "paymentMethod",
        "cardLast4", "cardBrand", "datacapRecordNo", "datacapRefNumber", status, "employeeId", notes)
       VALUES ($1, $2, $3, 'deposit', $4, $5, $6, $7, $8, $9, 'completed', $10, $11)`,
      depositId, res.locationId, id,
      amount, paymentMethod,
      cardLast4 || null, cardBrand || null,
      datacapRecordNo || null, datacapRefNumber || null,
      employeeId || null, notes || null
    )

    const newTotal = currentPaid + amount
    const fullyPaid = depositTarget > 0 ? newTotal >= depositTarget : false

    // Update depositStatus on reservation + auto-confirm if fully paid
    if (fullyPaid) {
      await db.reservation.update({
        where: { id },
        data: { depositStatus: 'paid', updatedAt: new Date() },
      })

      // Auto-confirm pending reservations when deposit is fully paid
      if (res.status === 'pending') {
        try {
          await db.$transaction(async (tx: any) => {
            const { transition } = await import('@/lib/reservations/state-machine')
            return transition({
              reservationId: id,
              to: 'confirmed',
              actor: { type: 'staff', id: employeeId || undefined },
              db: tx,
              locationId: callerLocationId,
            })
          })
        } catch (err) {
          // Non-fatal — deposit recorded, transition can be done manually
          console.warn('[Deposit] Auto-confirm after deposit failed:', err)
        }
      }
    }

    return NextResponse.json({
      data: {
        depositId,
        reservationId: id,
        amount,
        paymentMethod,
        previousTotal: Math.round(currentPaid * 100) / 100,
        newTotal: Math.round(newTotal * 100) / 100,
        fullyPaid,
        autoConfirmed: fullyPaid && res.status === 'pending',
      },
    })
  } catch (error) {
    console.error('Failed to record deposit:', error)
    return NextResponse.json({ error: 'Failed to record deposit' }, { status: 500 })
  }
})

// DELETE - Refund deposit
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, callerLocationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const depositId = searchParams.get('depositId')
    const reason = searchParams.get('reason') || 'Customer requested refund'

    // Load reservation (scoped to caller's location)
    const reservation = await db.$queryRawUnsafe<Array<{
      id: string
      locationId: string
      reservationDate: Date
      reservationTime: string
    }>>(
      `SELECT id, "locationId", "reservationDate", "reservationTime"
       FROM "Reservation" WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      id, callerLocationId
    )

    if (!reservation.length) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const res = reservation[0]

    // Load settings
    const location = await db.location.findUnique({
      where: { id: res.locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const depositSettings = settings.reservationDeposits

    // Calculate time until reservation
    const reservationDateTime = new Date(res.reservationDate)
    const [hours, mins] = res.reservationTime.split(':').map(Number)
    reservationDateTime.setHours(hours, mins, 0, 0)

    const hoursUntilReservation = (reservationDateTime.getTime() - Date.now()) / (1000 * 60 * 60)
    const refundableBeforeHours = depositSettings?.refundableBeforeHours ?? 24
    const nonRefundablePercent = depositSettings?.nonRefundablePercent ?? 0

    // If a specific deposit ID is provided, refund that one; otherwise refund all
    let depositsToRefund: Array<{ id: string; amount: string; refundedAmount: string }>
    if (depositId) {
      depositsToRefund = await db.$queryRawUnsafe<Array<{ id: string; amount: string; refundedAmount: string }>>(
        `SELECT id, amount, "refundedAmount" FROM "ReservationDeposit"
         WHERE id = $1 AND "reservationId" = $2 AND status = 'completed' AND "deletedAt" IS NULL`,
        depositId, id
      )
      if (!depositsToRefund.length) {
        return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
      }
    } else {
      depositsToRefund = await db.$queryRawUnsafe<Array<{ id: string; amount: string; refundedAmount: string }>>(
        `SELECT id, amount, "refundedAmount" FROM "ReservationDeposit"
         WHERE "reservationId" = $1 AND status = 'completed' AND "refundedAmount" < amount AND "deletedAt" IS NULL`,
        id
      )
    }

    if (!depositsToRefund.length) {
      return NextResponse.json({ error: 'No refundable deposits found' }, { status: 400 })
    }

    let totalRefunded = 0

    for (const deposit of depositsToRefund) {
      const remaining = Number(deposit.amount) - Number(deposit.refundedAmount)
      if (remaining <= 0) continue

      let refundAmount: number
      if (hoursUntilReservation < refundableBeforeHours) {
        // Outside refund window — only non-refundable portion can't be refunded
        // Actually outside window means NOTHING is refundable
        refundAmount = 0
      } else {
        // Inside refund window — refund minus non-refundable percent
        const nonRefundable = remaining * (nonRefundablePercent / 100)
        refundAmount = Math.round((remaining - nonRefundable) * 100) / 100
      }

      if (refundAmount <= 0) continue

      await db.$executeRawUnsafe(
        `UPDATE "ReservationDeposit"
         SET "refundedAmount" = "refundedAmount" + $1,
             "refundedAt" = CURRENT_TIMESTAMP,
             "refundReason" = $2,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $3`,
        refundAmount, reason, deposit.id
      )

      totalRefunded += refundAmount
    }

    if (totalRefunded === 0) {
      return NextResponse.json({
        error: hoursUntilReservation < refundableBeforeHours
          ? `Refund window has closed. Deposits are non-refundable within ${refundableBeforeHours} hours of reservation.`
          : 'No refundable amount available',
      }, { status: 400 })
    }

    return NextResponse.json({
      data: {
        reservationId: id,
        totalRefunded: Math.round(totalRefunded * 100) / 100,
        reason,
        withinRefundWindow: hoursUntilReservation >= refundableBeforeHours,
      },
    })
  } catch (error) {
    console.error('Failed to refund deposit:', error)
    return NextResponse.json({ error: 'Failed to refund deposit' }, { status: 500 })
  }
})
