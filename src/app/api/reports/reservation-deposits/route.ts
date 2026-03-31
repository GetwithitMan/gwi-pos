import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return err('Location ID required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Build date conditions using Prisma.sql for safe parameterization
    const dateConditions: Prisma.Sql[] = []
    if (startDate) {
      dateConditions.push(Prisma.sql`AND d."createdAt" >= ${new Date(startDate)}::timestamp`)
    }
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      dateConditions.push(Prisma.sql`AND d."createdAt" <= ${end}::timestamp`)
    }

    const dateFilter = dateConditions.length > 0
      ? Prisma.sql`${Prisma.join(dateConditions, ' ')}`
      : Prisma.empty

    // Fetch all deposits in period
    const deposits = await db.$queryRaw<Array<{
      id: string
      reservationId: string
      type: string
      amount: string
      paymentMethod: string
      cardLast4: string | null
      status: string
      refundedAmount: string
      refundedAt: Date | null
      refundReason: string | null
      createdAt: Date
      guestName: string
      partySize: number
      reservationDate: Date
      reservationTime: string
      reservationStatus: string
    }>>`
      SELECT d.id, d."reservationId", d.type, d.amount, d."paymentMethod",
              d."cardLast4", d.status, d."refundedAmount", d."refundedAt", d."refundReason",
              d."createdAt",
              r."guestName", r."partySize", r."reservationDate", r."reservationTime",
              r.status as "reservationStatus"
       FROM "ReservationDeposit" d
       JOIN "Reservation" r ON r.id = d."reservationId"
       WHERE d."locationId" = ${locationId} AND d."deletedAt" IS NULL ${dateFilter}
       ORDER BY d."createdAt" DESC`

    // Calculate summary metrics
    const totalCollected = deposits.reduce((sum, d) =>
      d.status === 'completed' ? sum + Number(d.amount) : sum, 0
    )
    const totalRefunded = deposits.reduce((sum, d) =>
      sum + Number(d.refundedAmount), 0
    )

    // Forfeited = non-refunded deposits on cancelled/no-show reservations
    const forfeited = deposits.reduce((sum, d) => {
      if (['cancelled', 'no_show'].includes(d.reservationStatus) && d.status === 'completed') {
        return sum + (Number(d.amount) - Number(d.refundedAmount))
      }
      return sum
    }, 0)

    // Outstanding = deposits on active (not completed/cancelled) reservations
    const outstanding = deposits.reduce((sum, d) => {
      if (!['completed', 'cancelled', 'no_show'].includes(d.reservationStatus) && d.status === 'completed') {
        return sum + (Number(d.amount) - Number(d.refundedAmount))
      }
      return sum
    }, 0)

    // By payment method
    const byMethod = deposits.reduce((acc, d) => {
      if (d.status !== 'completed') return acc
      const method = d.paymentMethod
      if (!acc[method]) acc[method] = { method, count: 0, total: 0 }
      acc[method].count++
      acc[method].total += Number(d.amount)
      return acc
    }, {} as Record<string, { method: string; count: number; total: number }>)

    // Daily trend — timezone-aware grouping
    const tzRd = process.env.TIMEZONE || process.env.TZ
    const dailyTrend = deposits.reduce((acc, d) => {
      if (d.status !== 'completed') return acc
      const date = tzRd ? new Date(d.createdAt).toLocaleDateString('en-CA', { timeZone: tzRd }) : new Date(d.createdAt).toISOString().split('T')[0]
      if (!acc[date]) acc[date] = { date, collected: 0, refunded: 0, count: 0 }
      acc[date].count++
      acc[date].collected += Number(d.amount)
      acc[date].refunded += Number(d.refundedAmount)
      return acc
    }, {} as Record<string, { date: string; collected: number; refunded: number; count: number }>)

    return ok({
        summary: {
          totalCollected: Math.round(totalCollected * 100) / 100,
          totalRefunded: Math.round(totalRefunded * 100) / 100,
          outstanding: Math.round(outstanding * 100) / 100,
          forfeited: Math.round(forfeited * 100) / 100,
          netRetained: Math.round((totalCollected - totalRefunded) * 100) / 100,
          depositCount: deposits.filter(d => d.status === 'completed').length,
        },
        byPaymentMethod: Object.values(byMethod).map(m => ({
          ...m,
          total: Math.round(m.total * 100) / 100,
        })),
        dailyTrend: Object.values(dailyTrend)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(d => ({
            ...d,
            collected: Math.round(d.collected * 100) / 100,
            refunded: Math.round(d.refunded * 100) / 100,
          })),
        recentDeposits: deposits.slice(0, 50).map(d => ({
          id: d.id,
          reservationId: d.reservationId,
          guestName: d.guestName,
          partySize: d.partySize,
          reservationDate: d.reservationDate,
          reservationTime: d.reservationTime,
          reservationStatus: d.reservationStatus,
          amount: Number(d.amount),
          paymentMethod: d.paymentMethod,
          cardLast4: d.cardLast4,
          status: d.status,
          refundedAmount: Number(d.refundedAmount),
          refundedAt: d.refundedAt,
          createdAt: d.createdAt,
        })),
      })
  } catch (error) {
    console.error('Reservation deposits report error:', error)
    return err('Failed to generate deposits report', 500)
  }
})
