/**
 * GET /api/checks/:id
 *
 * Returns a single check with its items and recent events.
 * Supports catch-up sync via ?afterSequence=N to fetch only
 * events after a known server sequence number.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { ok, notFound, err } from '@/lib/api-response'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('checks-get')

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = request.nextUrl
    const afterSequence = searchParams.get('afterSequence')

    const check = await db.check.findUnique({
      where: { id },
      include: {
        items: { where: { status: { not: 'removed' } } },
        events: afterSequence
          ? {
              where: { serverSequence: { gt: parseInt(afterSequence, 10) } },
              orderBy: { serverSequence: 'asc' },
            }
          : {
              orderBy: { serverSequence: 'asc' },
              take: 100,
            },
      },
    })

    if (!check) return notFound('Check not found')

    return ok({
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
      items: check.items.map(item => ({
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
      })),
      events: check.events.map(e => ({
        eventId: e.eventId,
        checkId: e.checkId,
        serverSequence: e.serverSequence,
        type: e.type,
        payload: JSON.parse(e.payloadJson),
        deviceId: e.deviceId,
        commandId: e.commandId,
        createdAt: e.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    log.error({ err: error }, 'Failed to fetch check')
    return err('Failed to fetch check', 500)
  }
}))
