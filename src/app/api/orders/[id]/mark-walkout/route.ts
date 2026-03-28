import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-mark-walkout')

// POST - Mark an open tab as a walkout and create retry records
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId } = body

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularWalkout = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularWalkout ? 'cloud' : 'local'

    if (!employeeId) {
      return err('Missing required field: employeeId')
    }

    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        cards: {
          where: { deletedAt: null, status: 'authorized' },
        },
        location: { select: { id: true, settings: true } },
      },
    })

    if (!order) {
      return notFound('Order not found')
    }

    // Require manager void permission — marking a walkout is a high-risk financial action
    const authResult = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_VOID_ORDERS)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

    if (order.cards.length === 0) {
      return err('No authorized cards on this tab to retry')
    }

    const locationId = order.locationId
    const settings = parseSettings(order.location.settings)
    const { walkoutRetryEnabled, walkoutRetryFrequencyDays, walkoutMaxRetryDays } = settings.payments

    const now = new Date()
    const tabAmount = Number(order.total)
    const maxRetries = Math.floor(walkoutMaxRetryDays / walkoutRetryFrequencyDays)

    // Mark order as walkout
    await db.order.update({
      where: { id: orderId },
      data: {
        isWalkout: true,
        walkoutAt: now,
        walkoutMarkedBy: employeeId,
        lastMutatedBy: mutationOrigin,
      },
    })

    // Fire-and-forget event emission
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      isWalkout: true,
      walkoutAt: now.toISOString(),
      walkoutMarkedBy: employeeId,
    }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'voided',
      orderId,
      tableId: order.tableId || undefined,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.mark-walkout'))
    const retries = []
    if (walkoutRetryEnabled) {
      const nextRetry = new Date(now)
      nextRetry.setDate(nextRetry.getDate() + walkoutRetryFrequencyDays)

      for (const card of order.cards) {
        const retry = await db.walkoutRetry.create({
          data: {
            locationId,
            orderId,
            orderCardId: card.id,
            amount: tabAmount,
            nextRetryAt: nextRetry,
            maxRetries,
            status: 'pending',
          },
        })
        retries.push({
          id: retry.id,
          cardLast4: card.cardLast4,
          cardType: card.cardType,
          nextRetryAt: nextRetry.toISOString(),
          maxRetries,
        })
      }
    }

    pushUpstream()

    return ok({
        success: true,
        walkoutAt: now.toISOString(),
        amount: tabAmount,
        retries,
        retryEnabled: walkoutRetryEnabled,
      })
  } catch (error) {
    console.error('Failed to mark walkout:', error)
    return err('Failed to mark walkout', 500)
  }
})
