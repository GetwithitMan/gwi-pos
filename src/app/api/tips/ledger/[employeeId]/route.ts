import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLedgerBalance, getLedgerEntries, centsToDollars } from '@/lib/domain/tips'
import type { LedgerSourceType, LedgerEntriesFilter } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'

const VALID_SOURCE_TYPES: LedgerSourceType[] = [
  'DIRECT_TIP',
  'TIP_GROUP',
  'ROLE_TIPOUT',
  'MANUAL_TRANSFER',
  'PAYOUT_CASH',
  'PAYOUT_PAYROLL',
  'CHARGEBACK',
  'ADJUSTMENT',
]

// GET - Full ledger statement with filters (admin or self-access)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  try {
    const { employeeId: targetEmployeeId } = await params

    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const sourceType = searchParams.get('sourceType')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Self-access: employees can always view their own ledger
    const isSelfAccess = targetEmployeeId && requestingEmployeeId && targetEmployeeId === requestingEmployeeId
    if (!isSelfAccess) {
      const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.TIPS_VIEW_LEDGER)
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
    }

    // Validate sourceType if provided
    if (sourceType && !VALID_SOURCE_TYPES.includes(sourceType as LedgerSourceType)) {
      return NextResponse.json(
        { error: `Invalid sourceType. Must be one of: ${VALID_SOURCE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 50)) : 50
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0

    // Build filters
    const filters: LedgerEntriesFilter = {
      limit,
      offset,
    }

    if (dateFrom) {
      filters.dateFrom = new Date(dateFrom)
    }
    if (dateTo) {
      const dateToEnd = new Date(dateTo)
      dateToEnd.setHours(23, 59, 59, 999)
      filters.dateTo = dateToEnd
    }
    if (sourceType) {
      filters.sourceType = sourceType as LedgerSourceType
    }

    // Get balance and entries
    const balance = await getLedgerBalance(targetEmployeeId)
    const { entries, total } = await getLedgerEntries(targetEmployeeId, filters)

    return NextResponse.json({
      balance: balance
        ? {
            currentBalanceCents: balance.currentBalanceCents,
            currentBalanceDollars: centsToDollars(balance.currentBalanceCents),
            employeeId: balance.employeeId,
            ledgerId: balance.ledgerId,
          }
        : {
            currentBalanceCents: 0,
            currentBalanceDollars: 0,
            employeeId: targetEmployeeId,
            ledgerId: null,
          },
      entries: entries.map(entry => ({
        id: entry.id,
        type: entry.type,
        amountCents: entry.amountCents,
        amountDollars: centsToDollars(entry.amountCents),
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        memo: entry.memo,
        shiftId: entry.shiftId,
        orderId: entry.orderId,
        adjustmentId: entry.adjustmentId,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      filters: {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        sourceType: sourceType || null,
        limit,
        offset,
      },
    })
  } catch (error) {
    console.error('Failed to get tip ledger statement:', error)
    return NextResponse.json(
      { error: 'Failed to get tip ledger statement' },
      { status: 500 }
    )
  }
})
