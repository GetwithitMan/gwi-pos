import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { MenuItemRepository } from '@/lib/repositories'
import { resolvePlu } from '@/lib/berg/plu-resolver'
import { isItemTaxInclusive } from '@/lib/order-calculations'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('cron-berg-reprocess')

// TODO: Migrate adminDb.bergDispenseEvent, db.terminal, and adminDb.orderItem.create calls
// to repositories once BergDevice/Terminal repositories exist.

export const maxDuration = 60

const BATCH_SIZE = 50
const STALE_THRESHOLD_MS = 10_000
const FAILED_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Find the most recent open order on the terminal linked to a Berg device.
 * Mirrors the logic in /api/berg/dispense/route.ts.
 */
async function findOpenOrderForTerminal(
  venueDb: any,
  locationId: string,
  terminalId: string,
): Promise<{ order: { id: string } | null; multipleOpen: boolean }> {
  const terminal = await venueDb.terminal.findUnique({
    where: { id: terminalId },
    select: { id: true },
  })
  if (!terminal) return { order: null, multipleOpen: false }

  const openOrders = await adminDb.order.findMany({
    where: {
      locationId,
      offlineTerminalId: terminal.id,
      status: { in: ['open', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
    take: 2,
  })

  return {
    order: openOrders[0] ?? null,
    multipleOpen: openOrders.length > 1,
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const allResults: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    const now = Date.now()
    const staleThreshold = new Date(now - STALE_THRESHOLD_MS)
    const failedRetryWindow = new Date(now - FAILED_RETRY_WINDOW_MS)

    // Find events that need reprocessing:
    // 1. PENDING and older than 10s — fire-and-forget async block died
    // 2. FAILED within 24h — retry BEST_EFFORT failures
    const events = await venueDb.bergDispenseEvent.findMany({
      where: {
        OR: [
          { postProcessStatus: 'PENDING', receivedAt: { lt: staleThreshold } },
          {
            postProcessStatus: 'FAILED',
            status: 'ACK_BEST_EFFORT',
            receivedAt: { gt: failedRetryWindow },
          },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: BATCH_SIZE,
    })

    if (events.length === 0) {
      allResults[slug] = { processed: 0 }
      return
    }

    let succeeded = 0
    let failed = 0

    for (const event of events) {
      try {
        const device = await venueDb.bergDevice.findFirst({
          where: { id: event.deviceId, isActive: true },
        })
        if (!device) {
          await venueDb.bergDispenseEvent.update({
            where: { id: event.id },
            data: { postProcessStatus: 'FAILED', postProcessError: 'Device not found or inactive' },
          })
          failed++
          continue
        }

        const resolvedPlu = await resolvePlu(
          event.pluNumber,
          event.deviceId,
          event.locationId,
          event.modifierBytes,
        )

        let orderId: string | null = null
        let orderItemId: string | null = null
        let unmatchedType: string | null = null
        let errorReason: string | null = null
        let pourCost: import('@prisma/client').Prisma.Decimal | null = null

        if (resolvedPlu === null) {
          unmatchedType = 'UNKNOWN_PLU_ACKED'
        } else if (device.autoRingMode === 'AUTO_RING' || device.autoRingMode === 'OFF') {
          const result = device.terminalId
            ? await findOpenOrderForTerminal(venueDb, device.locationId, device.terminalId)
            : { order: null, multipleOpen: false }

          if (result.multipleOpen && device.autoRingOnlyWhenSingleOpenOrder) {
            unmatchedType = 'NO_ORDER_ACKED'
            errorReason = 'MULTIPLE_OPEN_ORDERS'
            if (resolvedPlu.menuItemId) {
              const menuItem = await MenuItemRepository.getMenuItemByIdWithSelect(
                resolvedPlu.menuItemId,
                device.locationId,
                { price: true },
              )
              if (menuItem) pourCost = menuItem.price
            }
          } else if (result.order && device.autoRingMode === 'AUTO_RING' && resolvedPlu.menuItemId) {
            const menuItem = await MenuItemRepository.getMenuItemByIdWithInclude(
              resolvedPlu.menuItemId,
              device.locationId,
              { category: { select: { categoryType: true } } },
            )
            if (menuItem) {
              // Load tax-inclusive settings for this location
              const loc = await venueDb.location.findUnique({
                where: { id: device.locationId },
                select: { settings: true },
              })
              const locSettings = loc?.settings as Record<string, unknown> | null
              const taxCfg = locSettings?.tax as { taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean } | undefined
              const taxIncSettings = {
                taxInclusiveLiquor: taxCfg?.taxInclusiveLiquor ?? false,
                taxInclusiveFood: taxCfg?.taxInclusiveFood ?? false,
              }
              const oi = await adminDb.orderItem.create({
                data: {
                  locationId: device.locationId,
                  orderId: result.order.id,
                  menuItemId: menuItem.id,
                  name: menuItem.name,
                  price: menuItem.price,
                  quantity: 1,
                  status: 'active',
                  isTaxInclusive: isItemTaxInclusive(menuItem.category?.categoryType, taxIncSettings),
                },
              })
              orderId = result.order.id
              orderItemId = oi.id
              pourCost = menuItem.price
            }
          } else if (!result.order) {
            if (resolvedPlu.menuItemId) {
              const menuItem = await MenuItemRepository.getMenuItemByIdWithSelect(
                resolvedPlu.menuItemId,
                device.locationId,
                { price: true },
              )
              if (menuItem) pourCost = menuItem.price
            }
            unmatchedType = 'NO_ORDER_ACKED'
          }
        }

        await venueDb.bergDispenseEvent.update({
          where: { id: event.id },
          data: {
            orderId,
            orderItemId,
            unmatchedType,
            errorReason,
            pourCost,
            variantKey: resolvedPlu?.variantKey ?? null,
            variantLabel: resolvedPlu?.variantLabel ?? null,
            resolutionStatus: resolvedPlu?.resolutionStatus ?? 'NONE',
            postProcessStatus: 'DONE',
            postProcessError: null,
          },
        })
        succeeded++
      } catch (err) {
        console.error(`[cron:berg-reprocess] Venue ${slug}: Failed to reprocess event ${event.id}:`, err)
        await venueDb.bergDispenseEvent.update({
          where: { id: event.id },
          data: {
            postProcessStatus: 'FAILED',
            postProcessError: err instanceof Error ? err.message : String(err),
          },
        }).catch(err => log.warn({ err }, 'Background task failed'))
        failed++
      }
    }

    allResults[slug] = { processed: events.length, succeeded, failed }
  }, { label: 'cron:berg-reprocess' })

  return NextResponse.json({ ...summary, data: allResults })
}
