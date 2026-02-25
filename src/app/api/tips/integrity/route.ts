/**
 * Tip Ledger Integrity Check API (Skill 272)
 *
 * GET - Run integrity check on tip ledger balances
 *       ?locationId=xxx           (required)
 *       &fix=true                 (optional: fix mismatches)
 *       &reconcile=true           (optional: reconcile ledger vs payments)
 *
 * Reports:
 * 1. Balance mismatches: cached currentBalanceCents vs actual sum of entries
 * 2. Reconciliation: total ledger credits vs total tip payments for the period
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { recalculateBalance } from '@/lib/domain/tips/tip-ledger'
import { withVenue } from '@/lib/with-venue'

// ─── Types ───────────────────────────────────────────────────────────────────

interface BalanceMismatch {
  employeeId: string
  employeeName: string
  cachedCents: number
  calculatedCents: number
  driftCents: number
  fixed: boolean
}

interface ReconciliationResult {
  ledgerTotalCreditsCents: number
  ledgerTotalDebitsCents: number
  ledgerNetCents: number
  paymentsTotalTipsCents: number
  differenceCents: number
  withinTolerance: boolean
}

// ─── GET: Run integrity check ────────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const shouldFix = searchParams.get('fix') === 'true'
    const shouldReconcile = searchParams.get('reconcile') === 'true'

    // ── Validate ──────────────────────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // ── Auth: requires manager-level tip permission ───────────────────────
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requireAnyPermission(
      requestingEmployeeId,
      locationId,
      [PERMISSIONS.TIPS_MANAGE_GROUPS]
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Not authorized. Integrity checks require tip management permission.' },
        { status: 403 }
      )
    }

    // ── 1. Balance mismatch check ─────────────────────────────────────────
    // Find all active tip ledgers for this location
    const ledgers = await db.tipLedger.findMany({
      where: {
        locationId,
        deletedAt: null,
      },
      select: {
        id: true,
        employeeId: true,
        currentBalanceCents: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    })

    const mismatches: BalanceMismatch[] = []

    for (const ledger of ledgers) {
      // Sum all entries for this ledger
      const result = await db.tipLedgerEntry.aggregate({
        where: {
          ledgerId: ledger.id,
          deletedAt: null,
        },
        _sum: { amountCents: true },
      })

      const calculatedCents = Number(result._sum.amountCents || 0)
      const cachedCents = Number(ledger.currentBalanceCents)

      if (calculatedCents !== cachedCents) {
        let fixed = false

        if (shouldFix) {
          // Use the existing recalculateBalance which auto-fixes
          const fixResult = await recalculateBalance(ledger.employeeId)
          fixed = fixResult.fixed
        }

        mismatches.push({
          employeeId: ledger.employeeId,
          employeeName: `${ledger.employee.firstName} ${ledger.employee.lastName}`,
          cachedCents,
          calculatedCents,
          driftCents: calculatedCents - cachedCents,
          fixed,
        })
      }
    }

    // ── 2. Reconciliation (optional) ──────────────────────────────────────
    let reconciliation: ReconciliationResult | undefined

    if (shouldReconcile) {
      // Sum all ledger credits and debits for this location
      const ledgerCredits = await db.tipLedgerEntry.aggregate({
        where: {
          locationId,
          type: 'CREDIT',
          deletedAt: null,
        },
        _sum: { amountCents: true },
      })

      const ledgerDebits = await db.tipLedgerEntry.aggregate({
        where: {
          locationId,
          type: 'DEBIT',
          deletedAt: null,
        },
        _sum: { amountCents: true },
      })

      // Sum all tip amounts from Payments
      const paymentTips = await db.payment.aggregate({
        where: {
          order: { locationId },
          deletedAt: null,
          tipAmount: { gt: 0 },
        },
        _sum: { tipAmount: true },
      })

      const creditsCents = Number(ledgerCredits._sum.amountCents || 0)
      const debitsCents = Math.abs(Number(ledgerDebits._sum.amountCents || 0))
      const netCents = creditsCents - debitsCents
      // Payment tipAmount is in dollars (Decimal), convert to cents
      const paymentTipsCents = Math.round(
        Number(paymentTips._sum.tipAmount || 0) * 100
      )

      // Compare total ledger credits (DIRECT_TIP + TIP_GROUP, which are the
      // tip income entries) against total payment tips. They should match
      // within 1 cent per payment (rounding tolerance).
      const tipIncomeCredits = await db.tipLedgerEntry.aggregate({
        where: {
          locationId,
          type: 'CREDIT',
          sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
          deletedAt: null,
        },
        _sum: { amountCents: true },
      })

      const tipIncomeCents = Number(tipIncomeCredits._sum.amountCents || 0)
      const differenceCents = Math.abs(tipIncomeCents - paymentTipsCents)

      // Allow 1 cent tolerance per payment (rounding)
      const paymentCount = await db.payment.count({
        where: {
          order: { locationId },
          deletedAt: null,
          tipAmount: { gt: 0 },
        },
      })

      reconciliation = {
        ledgerTotalCreditsCents: creditsCents,
        ledgerTotalDebitsCents: debitsCents,
        ledgerNetCents: netCents,
        paymentsTotalTipsCents: paymentTipsCents,
        differenceCents,
        withinTolerance: differenceCents <= paymentCount,
      }
    }

    // ── Response ──────────────────────────────────────────────────────────

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      locationId,
      totalLedgers: ledgers.length,
      mismatchCount: mismatches.length,
      fixApplied: shouldFix,
      mismatches,
      ...(reconciliation && { reconciliation }),
    })
  } catch (error) {
    console.error('Tip ledger integrity check failed:', error)
    return NextResponse.json(
      { error: 'Tip ledger integrity check failed' },
      { status: 500 }
    )
  }
})
