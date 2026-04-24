/**
 * GET /api/checks/open
 *
 * Returns active checks (draft, committed, paid) for a location.
 *
 * Modes:
 *   ?mode=summary  (default) — lightweight list for sidebar / floor plan
 *   ?mode=full     — includes items array for each check
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { ok, err } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('checks-open')

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(
  request: NextRequest
) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const mode = searchParams.get('mode') || 'summary'

    if (!locationId) return err('locationId is required')

    const checks = await db.check.findMany({
      where: {
        locationId,
        status: { in: ['draft', 'committed', 'paid'] },
        deletedAt: null,
      },
      include: mode === 'full' ? {
        items: { where: { status: { not: 'removed' } } },
      } : undefined,
      orderBy: { createdAt: 'desc' },
    })

    const response = checks.map(check => ({
      id: check.id,
      locationId: check.locationId,
      employeeId: check.employeeId,
      orderType: check.orderType,
      tableId: check.tableId,
      tabName: check.tabName,
      guestCount: check.guestCount,
      status: check.status,
      orderNumber: check.orderNumber,
      displayNumber: check.displayNumber,
      terminalId: check.terminalId,
      leaseAcquiredAt: check.leaseAcquiredAt?.toISOString() ?? null,
      leaseLastHeartbeatAt: check.leaseLastHeartbeatAt?.toISOString() ?? null,
      notes: check.notes,
      isBottleService: check.isBottleService,
      bottleServiceTierId: check.bottleServiceTierId,
      orderId: check.orderId,
      createdAt: check.createdAt.toISOString(),
      updatedAt: check.updatedAt.toISOString(),
      ...(mode === 'full' && (check as any).items ? {
        items: (check as any).items.map((item: any) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          priceCents: item.priceCents,
          quantity: item.quantity,
          modifiersJson: item.modifiersJson,
          specialNotes: item.specialNotes,
          seatNumber: item.seatNumber,
          courseNumber: item.courseNumber,
          itemType: item.itemType,
          blockTimeMinutes: item.blockTimeMinutes,
          isHeld: item.isHeld,
          delayMinutes: item.delayMinutes,
          status: item.status,
          soldByWeight: item.soldByWeight,
          weight: item.weight,
          weightUnit: item.weightUnit,
          unitPriceCents: item.unitPriceCents,
          pricingOptionId: item.pricingOptionId,
          pricingOptionLabel: item.pricingOptionLabel,
          pourSize: item.pourSize,
          pourMultiplier: item.pourMultiplier,
          isTaxInclusive: item.isTaxInclusive,
          pizzaConfigJson: item.pizzaConfigJson,
          comboSelectionsJson: item.comboSelectionsJson,
        }))
      } : {}),
    }))

    return ok({
      checks: response,
      count: response.length,
      mode,
    })
  } catch (error) {
    log.error({ err: error }, 'Failed to fetch open checks')
    return err('Failed to fetch open checks', 500)
  }
}))
