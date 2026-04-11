// Reads use TipLedgerEntry (migrated from legacy models in Skill 273).
// TipBank model removed in Skill 284. TipShare remains for payout lifecycle.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { centsToDollars, getLedgerBalance, findActiveGroupForEmployee } from '@/lib/domain/tips'
import { withVenue } from '@/lib/with-venue'
import { getRequestLocationId } from '@/lib/request-context'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get pending tips for an employee
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, locationId: true },
      })
      if (!employee) {
        return notFound('Employee not found')
      }
      locationId = employee.locationId
    }

    // ── Pending tips: tip share credits (role-based + custom shift shares) ──
    // These replace the old db.tipShare.findMany({ status: 'pending' })
    const roleTipoutCredits = await db.tipLedgerEntry.findMany({
      where: {
        employeeId,
        locationId,
        sourceType: { in: ['ROLE_TIPOUT', 'MANUAL_TRANSFER'] },
        type: 'CREDIT',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })

    // Find counterparty names: for each CREDIT, find the matching DEBIT
    // with the same sourceId to identify who gave the tip-out.
    const sourceIds = roleTipoutCredits
      .map(e => e.sourceId)
      .filter((id): id is string => id !== null)

    const counterpartyEntries = sourceIds.length > 0
      ? await db.tipLedgerEntry.findMany({
          where: {
            sourceId: { in: sourceIds },
            sourceType: { in: ['ROLE_TIPOUT', 'MANUAL_TRANSFER'] },
            type: 'DEBIT',
            deletedAt: null,
            employeeId: { not: employeeId },
          },
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        })
      : []

    // Build sourceId -> fromEmployee name lookup
    const sourceToFromEmployee = new Map<string, string>()
    for (const entry of counterpartyEntries) {
      if (entry.sourceId) {
        sourceToFromEmployee.set(
          entry.sourceId,
          entry.employee.displayName ||
            `${entry.employee.firstName} ${entry.employee.lastName}`
        )
      }
    }

    // ── Banked tips: DIRECT_TIP and TIP_GROUP credits ────────────────────
    const bankedCredits = await db.tipLedgerEntry.findMany({
      where: {
        employeeId,
        locationId,
        type: 'CREDIT',
        sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })

    // For banked tips, the "fromEmployee" context comes from the memo or
    // order association. Since TipLedgerEntry doesn't link directly to
    // a "from" employee for DIRECT_TIP, we use the memo as the source.
    // This preserves the UI contract.

    // Calculate totals (cents -> dollars)
    const pendingTotalCents = roleTipoutCredits.reduce(
      (sum, e) => sum + Math.abs(Number(e.amountCents)),
      0
    )
    const bankedTotalCents = bankedCredits.reduce(
      (sum, e) => sum + Math.abs(Number(e.amountCents)),
      0
    )

    const pendingTotal = centsToDollars(pendingTotalCents)
    const bankedTotal = centsToDollars(bankedTotalCents)

    // ── CC fee total: sum of all CC fees deducted from this employee's tips today ──
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)

    // Fetch balance, CC fee total, and active tip group in parallel
    const [balance, ccFeeResult, activeGroup] = await Promise.all([
      getLedgerBalance(employeeId),
      db.tipTransaction.aggregate({
        where: {
          primaryEmployeeId: employeeId,
          locationId,
          ccFeeAmountCents: { gt: 0 },
          collectedAt: { gte: todayStart, lte: todayEnd },
          deletedAt: null,
        },
        _sum: { ccFeeAmountCents: true },
      }),
      findActiveGroupForEmployee(employeeId),
    ])

    const ccFeeTotalCents = Number(ccFeeResult._sum.ccFeeAmountCents || 0)

    // Build tip group info for the response
    let tipGroupName: string | null = null
    let tipGroupMembers: string[] = []
    if (activeGroup) {
      tipGroupName = `Tip Group`
      tipGroupMembers = activeGroup.members
        .filter(m => m.status === 'active' && m.employeeId !== employeeId)
        .map(m => m.displayName || `${m.firstName} ${m.lastName}`)
    }

    return ok({
      pending: {
        tips: roleTipoutCredits.map(entry => ({
          id: entry.id,
          amount: centsToDollars(Math.abs(Number(entry.amountCents))),
          shareType: 'role_tipout',
          fromEmployee: (entry.sourceId && sourceToFromEmployee.get(entry.sourceId))
            || entry.memo
            || 'Unknown',
          percentage: null, // Percentage not stored on ledger entries; use memo for context
          createdAt: entry.createdAt.toISOString(),
        })),
        total: Math.round(pendingTotal * 100) / 100,
      },
      banked: {
        tips: bankedCredits.map(entry => ({
          id: entry.id,
          amount: centsToDollars(Math.abs(Number(entry.amountCents))),
          source: entry.sourceType === 'DIRECT_TIP' ? 'direct_tip' : 'tip_group',
          fromEmployee: entry.memo || 'Tip',
          createdAt: entry.createdAt.toISOString(),
        })),
        total: Math.round(bankedTotal * 100) / 100,
      },
      grandTotal: Math.round((pendingTotal + bankedTotal) * 100) / 100,
      // Extra field: ledger balance for UIs that want the true running balance
      ledgerBalanceCents: balance?.currentBalanceCents ?? 0,
      ledgerBalanceDollars: centsToDollars(balance?.currentBalanceCents ?? 0),
      // CC fee deductions today
      ccFeeTotal: centsToDollars(ccFeeTotalCents),
      ccFeeTotalCents,
      // Tip group membership
      tipGroupName,
      tipGroupMembers,
    })
  } catch (error) {
    console.error('Failed to fetch pending tips:', error)
    return err('Failed to fetch pending tips', 500)
  }
})

// POST - Collect pending tips
// DEFERRED: The "collect/accept" concept doesn't map cleanly to the immutable ledger model.
// In the ledger system, tip collection happens via PAYOUT_CASH or PAYOUT_PAYROLL debit
// entries (see /api/tips/payouts). This legacy endpoint is kept for backward compatibility
// until the UI is migrated to use the payout flow — tracked in PM-TASK-BOARD.md
// POST - Accept/collect tips (updates TipShare status only — TipBank removed in Skill 284)
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const body = await request.json()
    const { action } = body as { action: 'collect' | 'collect_all' | 'accept' | 'accept_all' }

    const now = new Date()

    if (action === 'collect' || action === 'collect_all' || action === 'accept' || action === 'accept_all') {
      // Mark TipShare records as accepted (employee acknowledged).
      // New tip flows use TipLedgerEntry exclusively (see /api/tips/payouts).

      // Update all pending tip shares to accepted (employee acknowledged)
      const updatedPendingShares = await db.tipShare.updateMany({
        where: {
          toEmployeeId: employeeId,
          status: 'pending',
        },
        data: {
          status: 'accepted',
          collectedAt: now,
        },
      })

      // Update all banked tip shares to accepted
      const updatedBankedShares = await db.tipShare.updateMany({
        where: {
          toEmployeeId: employeeId,
          status: 'banked',
        },
        data: {
          status: 'accepted',
          collectedAt: now,
        },
      })

      const totalAccepted = updatedPendingShares.count + updatedBankedShares.count
      pushUpstream()

      return ok({
        message: `Accepted ${totalAccepted} tip share(s) - will be added to payroll`,
        acceptedCount: totalAccepted,
        pendingSharesAccepted: updatedPendingShares.count,
        bankedSharesAccepted: updatedBankedShares.count,
        acceptedAt: now.toISOString(),
      })
    }

    return err('Invalid action')
  } catch (error) {
    console.error('Failed to collect tips:', error)
    return err('Failed to collect tips', 500)
  }
}))
