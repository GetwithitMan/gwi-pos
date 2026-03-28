/**
 * GET /api/tips/recorded-tips
 *
 * Returns closed card payments with tipAmount > 0 for the requesting employee.
 * Used by the "My Tips" screen to show already-tipped checks.
 *
 * Query params:
 *   locationId  - required
 *   employeeId  - optional (defaults to requesting employee; requires TIPS_VIEW_LEDGER for others)
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok, unauthorized } from '@/lib/api-response'

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const queryEmployeeId = searchParams.get('employeeId')
    const requestingEmployeeId = request.headers.get('x-employee-id')

    if (!locationId) {
      return err('locationId is required')
    }

    if (!requestingEmployeeId) {
      return unauthorized('Employee ID is required')
    }

    // Determine target employee — default to self
    const targetEmployeeId = queryEmployeeId || requestingEmployeeId

    // Auth: querying own data = any authenticated employee; querying others = TIPS_VIEW_LEDGER
    if (targetEmployeeId !== requestingEmployeeId) {
      const auth = await requireAnyPermission(
        requestingEmployeeId,
        locationId,
        [PERMISSIONS.TIPS_VIEW_LEDGER]
      )
      if (!auth.authorized) {
        return err(auth.error, auth.status)
      }
    }

    // Query card payments with tipAmount > 0
    const payments = await db.payment.findMany({
      where: {
        locationId,
        tipAmount: { gt: 0 },
        status: 'completed',
        paymentMethod: { notIn: ['cash', 'gift_card', 'house_account'] },
        voidedAt: null,
        deletedAt: null,
        order: {
          employeeId: targetEmployeeId,
        },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            tabName: true,
            tabNickname: true,
            employeeId: true,
            employee: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        // M6: include shift info so Android can enforce the 24h edit boundary
        shift: {
          select: {
            status: true,
            endedAt: true,
          },
        },
      },
      orderBy: { processedAt: 'desc' },
      take: 100,
    })

    const recordedTips = payments.map(p => ({
      orderId: p.order.id,
      orderNumber: p.order.orderNumber,
      paymentId: p.id,
      tabName: p.order.tabName || null,
      tabNickname: p.order.tabNickname || null,
      cardBrand: p.cardBrand || null,
      cardLast4: p.cardLast4 || null,
      baseAmount: Number(p.amount),
      tipAmount: Number(p.tipAmount),
      closedAt: p.processedAt.toISOString(),
      employeeId: p.order.employeeId,
      employeeName: p.order.employee
        ? (p.order.employee.displayName || `${p.order.employee.firstName} ${p.order.employee.lastName}`)
        : null,
      // M6: shift close timestamp so Android can enforce the 24h edit window
      shiftClosedAt: p.shift?.endedAt?.toISOString() ?? null,
    }))

    return ok({ recordedTips })
  } catch (error) {
    console.error('[recorded-tips] Failed:', error)
    return err('Failed to load recorded tips', 500)
  }
}))
