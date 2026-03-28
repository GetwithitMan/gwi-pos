/**
 * Cash Tip Declarations API (Skill 259)
 *
 * POST - Declare cash tips for a shift (self-declaration or manager override)
 * GET  - List cash tip declarations with filters
 */

import { NextRequest } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { checkDeclarationMinimum } from '@/lib/domain/tips/tip-compliance'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, ok } from '@/lib/api-response'

// ─── POST: Declare cash tips ─────────────────────────────────────────────────

export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, shiftId, amountCents, totalSalesCents } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    if (!employeeId) {
      return err('employeeId is required')
    }

    if (amountCents === undefined || amountCents === null) {
      return err('amountCents is required')
    }

    if (typeof amountCents !== 'number' || amountCents < 0) {
      return err('amountCents must be a non-negative number')
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Self-declaration: requesting employee === employeeId
    // Manager override: requires TIPS_MANAGE_GROUPS permission
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const isSelfDeclaration = requestingEmployeeId === employeeId

    if (!isSelfDeclaration) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        locationId,
        [PERMISSIONS.TIPS_MANAGE_GROUPS]
      )
      if (!auth.authorized) {
        return forbidden('Not authorized. Only the declaring employee or a manager with tip management permission can create declarations.')
      }
    }

    // ── Determine source ──────────────────────────────────────────────────
    const source = isSelfDeclaration ? 'employee' : 'manager_override'
    const overrideBy = isSelfDeclaration ? null : requestingEmployeeId

    // ── Create declaration ────────────────────────────────────────────────
    const declaration = await db.cashTipDeclaration.create({
      data: {
        locationId,
        employeeId,
        shiftId: shiftId || null,
        amountCents,
        source,
        overrideBy,
        overrideReason: isSelfDeclaration ? null : (body.overrideReason || null),
      },
    })

    // ── Outage queue protection ───────────────────────────────────────────
    try {
      await queueIfOutageOrFail('CashTipDeclaration', locationId, declaration.id, 'INSERT')
    } catch (caughtErr) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }
    pushUpstream()

    // ── Compliance check (optional) ───────────────────────────────────────
    let complianceWarnings: { code: string; level: string; message: string; details?: Record<string, unknown> }[] | undefined

    if (totalSalesCents !== undefined && totalSalesCents !== null && typeof totalSalesCents === 'number') {
      const result = checkDeclarationMinimum({
        declaredCashTipsCents: amountCents,
        totalSalesCents,
      })
      if (result.warnings.length > 0) {
        complianceWarnings = result.warnings
      }
    }

    // ── Over-declaration check (Skill 270 — Double-Counting Guard) ──────
    // Cash tips already flow through the TipLedger as DIRECT_TIP credits.
    // CashTipDeclaration is for IRS reporting only. Warn if declared amount
    // exceeds actual cash tip ledger entries for the shift, which suggests
    // possible over-declaration.
    if (shiftId) {
      const cashTipEntries = await db.tipLedgerEntry.aggregate({
        where: {
          employeeId,
          shiftId,
          sourceType: 'DIRECT_TIP',
          type: 'CREDIT',
          deletedAt: null,
        },
        _sum: { amountCents: true },
      })
      const ledgerCashTipsCents = Number(cashTipEntries._sum.amountCents || 0)

      if (amountCents > ledgerCashTipsCents && ledgerCashTipsCents > 0) {
        if (!complianceWarnings) complianceWarnings = []
        complianceWarnings.push({
          code: 'OVER_DECLARATION',
          level: 'warning',
          message: `Declared amount ($${(amountCents / 100).toFixed(2)}) exceeds recorded cash tips ($${(ledgerCashTipsCents / 100).toFixed(2)}) for this shift. Cash declarations are for IRS reporting only — they do not add to your tip bank balance.`,
          details: {
            declaredCents: amountCents,
            ledgerCashTipsCents,
            differenceCents: amountCents - ledgerCashTipsCents,
          },
        })
      }
    }

    // ── Return success ────────────────────────────────────────────────────
    const response: Record<string, unknown> = {
      declaration: {
        id: declaration.id,
        employeeId: declaration.employeeId,
        amountCents: Number(declaration.amountCents),
        shiftId: declaration.shiftId,
        source: declaration.source,
        declaredAt: declaration.declaredAt.toISOString(),
      },
    }

    if (complianceWarnings) {
      response.complianceWarnings = complianceWarnings
    }

    return ok(response)
  } catch (error) {
    console.error('Failed to create cash tip declaration:', error)
    return err('Failed to create cash tip declaration', 500)
  }
}))

// ─── GET: List cash tip declarations ─────────────────────────────────────────

export const GET = withVenue(withAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const shiftId = searchParams.get('shiftId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return err('locationId is required')
    }

    // ── Auth check ────────────────────────────────────────────────────────
    // Self-access (requesting employee === employeeId filter) or TIPS_VIEW_LEDGER
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!employeeId) {
      // No employeeId filter = viewing all declarations, requires permission
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        locationId,
        [PERMISSIONS.TIPS_VIEW_LEDGER]
      )
      if (!auth.authorized) {
        return err(auth.error, auth.status)
      }
    } else {
      // Specific employee filter: self-access or permission
      const isSelfAccess = requestingEmployeeId === employeeId

      if (!isSelfAccess) {
        const auth = await requireAnyPermission(
          requestingEmployeeId,
          locationId,
          [PERMISSIONS.TIPS_VIEW_LEDGER]
        )
        if (!auth.authorized) {
          return err(auth.error, auth.status)
        }
      }
    }

    // ── Build filters ─────────────────────────────────────────────────────
    const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 50)) : 50
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0

    const where: {
      locationId: string
      employeeId?: string
      shiftId?: string
      deletedAt: null
      declaredAt?: { gte?: Date; lte?: Date }
    } = {
      locationId,
      deletedAt: null,
    }

    if (employeeId) {
      where.employeeId = employeeId
    }

    if (shiftId) {
      where.shiftId = shiftId
    }

    if (dateFrom || dateTo) {
      where.declaredAt = {}
      if (dateFrom) {
        where.declaredAt.gte = new Date(dateFrom)
      }
      if (dateTo) {
        const dateToEnd = new Date(dateTo)
        dateToEnd.setHours(23, 59, 59, 999)
        where.declaredAt.lte = dateToEnd
      }
    }

    // ── Query declarations ────────────────────────────────────────────────
    const [declarations, total] = await Promise.all([
      db.cashTipDeclaration.findMany({
        where,
        orderBy: { declaredAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      db.cashTipDeclaration.count({ where }),
    ])

    return ok({
      declarations: declarations.map((d) => ({
        id: d.id,
        employeeId: d.employeeId,
        shiftId: d.shiftId,
        amountCents: Number(d.amountCents),
        source: d.source,
        overrideReason: d.overrideReason,
        overrideBy: d.overrideBy,
        declaredAt: d.declaredAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to get cash tip declarations:', error)
    return err('Failed to get cash tip declarations', 500)
  }
}))
