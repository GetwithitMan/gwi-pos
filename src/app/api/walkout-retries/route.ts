import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getRequestLocationId } from '@/lib/request-context'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'

const log = createChildLogger('walkout-retries')

const VALID_STATUSES = ['pending', 'exhausted', 'written_off', 'collected'] as const
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

/**
 * GET /api/walkout-retries
 *
 * List walkout retries for the manager dashboard, filtered by status.
 *
 * Query params:
 *   - locationId (required if not in request context)
 *   - status: pending | exhausted | written_off | collected (optional, omit for all)
 *   - page: page number, 1-based (default 1)
 *   - pageSize: results per page (default 50, max 200)
 *   - employeeId: for auth (optional, resolved from session if missing)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE))

    // Resolve locationId
    const locationId = getRequestLocationId() || searchParams.get('locationId')
    if (!locationId) {
      return err('Missing locationId')
    }

    // Validate status filter if provided
    if (status && !VALID_STATUSES.includes(status as any)) {
      return err(`Invalid status filter. Valid values: ${VALID_STATUSES.join(', ')}`)
    }

    // Require manager-level permission (void payments covers walkout management)
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_VOID_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    // Build where clause
    const where: Record<string, unknown> = { locationId, deletedAt: null }
    if (status) {
      where.status = status
    }

    // Get total count for pagination
    const totalCount = await db.walkoutRetry.count({ where })

    // Fetch walkout retries with pagination
    const retries = await db.walkoutRetry.findMany({
      where,
      orderBy: [
        { status: 'asc' }, // pending/exhausted first, then collected/written_off
        { createdAt: 'desc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })

    if (retries.length === 0) {
      return ok({
        items: [],
        pagination: { page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
      })
    }

    // Batch-load related order cards
    const orderCardIds = [...new Set(retries.map(r => r.orderCardId))]
    const orderCards = await db.orderCard.findMany({
      where: { id: { in: orderCardIds } },
      select: { id: true, cardType: true, cardLast4: true, cardholderName: true },
    })
    const cardMap = new Map(orderCards.map(c => [c.id, c]))

    // Batch-load related orders via repository
    const orderIds = [...new Set(retries.map(r => r.orderId))]
    const orders = await db.$queryRaw<Array<{ id: string; orderNumber: number | null; total: string; status: string; createdAt: Date }>>`SELECT id, "orderNumber", total::text, status, "createdAt" FROM "Order" WHERE id = ANY(${orderIds}) AND "locationId" = ${locationId} AND "deletedAt" IS NULL`
    const orderMap = new Map(orders.map(o => [o.id, o]))

    // Batch-load employee names for writtenOffBy via repository
    const writerIds = retries.map(r => r.writtenOffBy).filter(Boolean) as string[]
    const uniqueWriterIds = [...new Set(writerIds)]
    const writers = uniqueWriterIds.length > 0
      ? await db.$queryRaw<Array<{ id: string; firstName: string; lastName: string; displayName: string | null }>>`SELECT id, "firstName", "lastName", "displayName" FROM "Employee" WHERE id = ANY(${uniqueWriterIds}) AND "locationId" = ${locationId} AND "deletedAt" IS NULL`
      : []
    const writerMap = new Map(writers.map(w => [w.id, w]))

    const items = retries.map(r => {
      const card = cardMap.get(r.orderCardId)
      const order = orderMap.get(r.orderId)
      const writer = r.writtenOffBy ? writerMap.get(r.writtenOffBy) : null

      return {
        id: r.id,
        orderId: r.orderId,
        amount: Number(r.amount),
        status: r.status,
        retryCount: r.retryCount,
        maxRetries: r.maxRetries,
        nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
        lastRetryAt: r.lastRetryAt?.toISOString() ?? null,
        lastRetryError: r.lastRetryError,
        collectedAt: r.collectedAt?.toISOString() ?? null,
        writtenOffAt: r.writtenOffAt?.toISOString() ?? null,
        writtenOffBy: r.writtenOffBy,
        writtenOffByName: writer
          ? (writer.displayName || `${writer.firstName} ${writer.lastName}`.trim())
          : null,
        createdAt: r.createdAt.toISOString(),
        order: order
          ? {
              id: order.id,
              orderNumber: order.orderNumber,
              total: Number(order.total),
              status: order.status,
              date: order.createdAt instanceof Date ? order.createdAt.toISOString() : String(order.createdAt),
            }
          : null,
        card: card
          ? {
              cardType: card.cardType,
              cardLast4: card.cardLast4,
              cardholderName: card.cardholderName,
            }
          : null,
      }
    })

    return ok({
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    })
  } catch (error) {
    log.error({ err: error }, 'Failed to list walkout retries')
    return err('Failed to list walkout retries', 500)
  }
})
