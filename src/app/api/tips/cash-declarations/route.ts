/**
 * Cash Tip Declarations API (Skill 259)
 *
 * POST - Declare cash tips for a shift (self-declaration or manager override)
 * GET  - List cash tip declarations with filters
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { checkDeclarationMinimum } from '@/lib/domain/tips/tip-compliance'
import { withVenue } from '@/lib/with-venue'

// ─── POST: Declare cash tips ─────────────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, employeeId, shiftId, amountCents, totalSalesCents } = body

    // ── Validate required fields ──────────────────────────────────────────

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
    }

    if (amountCents === undefined || amountCents === null) {
      return NextResponse.json(
        { error: 'amountCents is required' },
        { status: 400 }
      )
    }

    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 0) {
      return NextResponse.json(
        { error: 'amountCents must be a non-negative integer' },
        { status: 400 }
      )
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
        return NextResponse.json(
          { error: 'Not authorized. Only the declaring employee or a manager with tip management permission can create declarations.' },
          { status: 403 }
        )
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
      const ledgerCashTipsCents = cashTipEntries._sum.amountCents || 0

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
        amountCents: declaration.amountCents,
        shiftId: declaration.shiftId,
        source: declaration.source,
        declaredAt: declaration.declaredAt.toISOString(),
      },
    }

    if (complianceWarnings) {
      response.complianceWarnings = complianceWarnings
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to create cash tip declaration:', error)
    return NextResponse.json(
      { error: 'Failed to create cash tip declaration' },
      { status: 500 }
    )
  }
})

// ─── GET: List cash tip declarations ─────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
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
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
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
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        )
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
          return NextResponse.json(
            { error: auth.error },
            { status: auth.status }
          )
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

    return NextResponse.json({
      declarations: declarations.map((d) => ({
        id: d.id,
        employeeId: d.employeeId,
        shiftId: d.shiftId,
        amountCents: d.amountCents,
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
    return NextResponse.json(
      { error: 'Failed to get cash tip declarations' },
      { status: 500 }
    )
  }
})
