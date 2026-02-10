import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLedgerBalance, getLedgerEntries, centsToDollars } from '@/lib/domain/tips'

// GET - Get the requesting employee's own ledger balance + recent entries
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const limitParam = searchParams.get('limit')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      )
    }

    // Skill 279: Self-access is always allowed; viewing others requires permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    if (requestingEmployeeId && requestingEmployeeId !== employeeId) {
      const auth = await requireAnyPermission(requestingEmployeeId, locationId, [PERMISSIONS.TIPS_VIEW_LEDGER])
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Not authorized to view other employees\' tip ledger' },
          { status: 403 }
        )
      }
    }

    const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10) || 10)) : 10

    // Self-access: employees can always view their own ledger
    const balance = await getLedgerBalance(employeeId)

    if (!balance) {
      // No ledger yet — return zero balance with empty entries
      return NextResponse.json({
        balance: {
          currentBalanceCents: 0,
          currentBalanceDollars: 0,
          employeeId,
          ledgerId: null,
        },
        recentEntries: [],
        totalEntries: 0,
      })
    }

    const { entries, total } = await getLedgerEntries(employeeId, { limit })

    return NextResponse.json({
      balance: {
        currentBalanceCents: balance.currentBalanceCents,
        currentBalanceDollars: centsToDollars(balance.currentBalanceCents),
        employeeId: balance.employeeId,
        ledgerId: balance.ledgerId,
      },
      recentEntries: entries.map(entry => ({
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
      totalEntries: total,
    })
  } catch (error) {
    console.error('Failed to get tip ledger:', error)
    return NextResponse.json(
      { error: 'Failed to get tip ledger' },
      { status: 500 }
    )
  }
}
