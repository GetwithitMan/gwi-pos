import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { parseSettings, DEFAULT_WALKOUT_SETTINGS } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { logger } from '@/lib/logger'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Retry capture for a walkout tab (manual trigger)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    let body: { walkoutRetryId?: string; employeeId?: string }
    try {
      body = await request.json()
    } catch {
      return err('Invalid JSON request body')
    }
    const { walkoutRetryId, employeeId } = body

    if (!walkoutRetryId) {
      return err('Missing walkoutRetryId')
    }

    const retry = await db.walkoutRetry.findFirst({
      where: { id: walkoutRetryId, deletedAt: null, status: 'pending' },
    })

    if (!retry) {
      return notFound('Walkout retry not found or already resolved')
    }

    // Get the order card to retry against (include card info for Payment record)
    const orderCard = await db.orderCard.findFirst({
      where: { id: retry.orderCardId, deletedAt: null },
      select: { id: true, readerId: true, recordNo: true, cardType: true, cardLast4: true },
    })

    if (!orderCard) {
      return notFound('Order card not found')
    }

    const locationId = retry.locationId

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_CARD_PAYMENTS)
    if (!auth.authorized) {
      return err(auth.error, auth.status ?? 403)
    }

    const settings = parseSettings(await getLocationSettings(locationId))
    const { walkoutRetryFrequencyDays, walkoutMaxRetryDays } = settings.payments

    // ── Enforce walkout.maxCaptureRetries limit ──────────────────────────
    const walkoutConfig = settings.walkout ?? DEFAULT_WALKOUT_SETTINGS
    const maxCaptureRetries = walkoutConfig.maxCaptureRetries
    if (retry.retryCount >= maxCaptureRetries) {
      // Auto-mark as exhausted if retry count limit reached
      await db.walkoutRetry.update({
        where: { id: walkoutRetryId },
        data: { status: 'exhausted' },
      })
      pushUpstream()
      return ok({
          success: false,
          status: 'exhausted',
          retryCount: retry.retryCount,
          maxCaptureRetries,
          error: `Maximum retry attempts (${maxCaptureRetries}) reached`,
        })
    }

    try {
      await validateReader(orderCard.readerId, locationId)
      const client = await requireDatacapClient(locationId)

      const response = await client.preAuthCapture(orderCard.readerId, {
        recordNo: orderCard.recordNo,
        purchaseAmount: Number(retry.amount),
      })

      const error = parseError(response)
      const approved = response.cmdStatus === 'Approved'

      if (approved) {
        // BUG #459 FIX: Atomic guard — use updateMany with status filter to prevent double-charge.
        // If another request already collected this retry, the updateMany matches 0 rows.
        // Clock discipline: use DB-generated NOW() for payment-critical timestamps.
        const updatedRows = await db.$executeRawUnsafe(
          `UPDATE "WalkoutRetry"
           SET status = 'collected', "collectedAt" = NOW(), "lastRetryAt" = NOW(),
               "retryCount" = $1, "updatedAt" = NOW()
           WHERE id = $2 AND status = 'pending'`,
          retry.retryCount + 1,
          walkoutRetryId,
        )

        if (updatedRows === 0) {
          // Another request already collected — this is a duplicate
          return ok({ success: true, duplicate: true, status: 'collected', amount: Number(retry.amount) })
        }

        // BUG #459 FIX: Update OrderCard, Order status, and create Payment record
        // Clock discipline: use DB-generated NOW() for capturedAt, paidAt, closedAt.
        const captureAmount = Number(retry.amount)
        const paymentMethod = orderCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit'
        const cardBrand = orderCard.cardType || 'unknown'

        // Use raw SQL transaction for DB-generated timestamps on payment-critical fields
        const paymentRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
          `WITH oc AS (
            UPDATE "OrderCard"
            SET status = 'captured', "capturedAmount" = $1, "capturedAt" = NOW(), "updatedAt" = NOW()
            WHERE id = $2
          ), ord AS (
            UPDATE "Order"
            SET status = 'paid', "tabStatus" = 'closed', "paidAt" = NOW(), "closedAt" = NOW(), "updatedAt" = NOW()
            WHERE id = $3
          )
          INSERT INTO "Payment" (id, "locationId", "orderId", "employeeId", amount, "tipAmount", "totalAmount",
            "paymentMethod", "cardBrand", "cardLast4", "authCode", "datacapRecordNo", status, "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, $4, $3, $5, $1, 0, $1, $6, $7, $8, $9, $10, 'completed', NOW(), NOW())
          RETURNING id`,
          captureAmount,
          orderCard.id,
          retry.orderId,
          locationId,
          employeeId || null,
          paymentMethod,
          cardBrand,
          orderCard.cardLast4,
          response.authCode || null,
          orderCard.recordNo,
        )
        const createdPaymentId = paymentRows[0]?.id

        pushUpstream()

        // Emit PAYMENT_APPLIED + ORDER_CLOSED events (fire-and-forget)
        void emitOrderEvents(locationId, retry.orderId, [
          {
            type: 'PAYMENT_APPLIED',
            payload: {
              paymentId: createdPaymentId,
              method: paymentMethod,
              amountCents: Math.round(captureAmount * 100),
              tipCents: 0,
              totalCents: Math.round(captureAmount * 100),
              cardBrand: orderCard.cardType || 'unknown',
              cardLast4: orderCard.cardLast4,
              status: 'approved',
            },
          },
          {
            type: 'ORDER_CLOSED',
            payload: { closedStatus: 'paid' },
          },
        ])

        return ok({
            success: true,
            status: 'collected',
            amount: captureAmount,
            authCode: response.authCode,
          })
      } else {
        // Calculate next retry using DB time
        const now = new Date()
        const nextRetry = new Date(now)
        nextRetry.setDate(nextRetry.getDate() + walkoutRetryFrequencyDays)

        const createdAt = new Date(retry.createdAt)
        const maxDate = new Date(createdAt)
        maxDate.setDate(maxDate.getDate() + walkoutMaxRetryDays)

        const exhausted = nextRetry > maxDate
        const lastRetryError = error?.text || response.textResponse || 'Declined'

        // Clock discipline: use DB-generated NOW() for lastRetryAt
        await db.$executeRawUnsafe(
          `UPDATE "WalkoutRetry"
           SET "retryCount" = $1, "lastRetryAt" = NOW(), "lastRetryError" = $2,
               status = $3, "nextRetryAt" = $4, "updatedAt" = NOW()
           WHERE id = $5`,
          retry.retryCount + 1,
          lastRetryError,
          exhausted ? 'exhausted' : 'pending',
          exhausted ? retry.nextRetryAt : nextRetry,
          walkoutRetryId,
        )
        pushUpstream()

        return ok({
            success: false,
            status: exhausted ? 'exhausted' : 'pending',
            retryCount: retry.retryCount + 1,
            nextRetryAt: exhausted ? null : nextRetry.toISOString(),
            error: error ? { code: error.code, message: error.text } : null,
          })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Retry failed'

      // Clock discipline: use DB-generated NOW() for lastRetryAt
      await db.$executeRawUnsafe(
        `UPDATE "WalkoutRetry"
         SET "retryCount" = $1, "lastRetryAt" = NOW(), "lastRetryError" = $2, "updatedAt" = NOW()
         WHERE id = $3`,
        retry.retryCount + 1,
        errorMsg,
        walkoutRetryId,
      )
      pushUpstream()

      return ok({ success: false, error: errorMsg })
    }
  } catch (error) {
    logger.error('datacap', 'Failed to process walkout retry', error)
    return err('Failed to process walkout retry', 500)
  }
})

// GET - List walkout retries for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // pending | collected | exhausted | written_off
    const orderId = searchParams.get('orderId')

    if (!locationId) {
      return err('Missing locationId')
    }

    // If filtering by orderId, find order cards first to get walkout retry IDs
    let orderCardFilter: string[] | null = null
    if (orderId) {
      const orderCards = await db.orderCard.findMany({
        where: { orderId, deletedAt: null },
        select: { id: true },
      })
      orderCardFilter = orderCards.map(c => c.id)
      if (orderCardFilter.length === 0) {
        return ok([])
      }
    }

    const where: Record<string, unknown> = { locationId, deletedAt: null }
    if (status) where.status = status
    if (orderCardFilter) where.orderCardId = { in: orderCardFilter }

    const retries = await db.walkoutRetry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    // Enrich with order card info
    const orderCardIds = [...new Set(retries.map(r => r.orderCardId))]
    const orderCards = await db.orderCard.findMany({
      where: { id: { in: orderCardIds } },
      select: { id: true, cardType: true, cardLast4: true, cardholderName: true, orderId: true },
    })
    const cardMap = new Map(orderCards.map(c => [c.id, c]))

    return ok(retries.map(r => {
        const card = cardMap.get(r.orderCardId)
        return {
          id: r.id,
          orderId: card?.orderId,
          amount: Number(r.amount),
          status: r.status,
          retryCount: r.retryCount,
          maxRetries: r.maxRetries,
          nextRetryAt: r.nextRetryAt?.toISOString(),
          lastRetryAt: r.lastRetryAt?.toISOString(),
          lastRetryError: r.lastRetryError,
          collectedAt: r.collectedAt?.toISOString(),
          writtenOffAt: r.writtenOffAt?.toISOString(),
          cardType: card?.cardType,
          cardLast4: card?.cardLast4,
          cardholderName: card?.cardholderName,
          createdAt: r.createdAt.toISOString(),
        }
      }))
  } catch (error) {
    logger.error('datacap', 'Failed to list walkout retries', error)
    return err('Failed to list walkout retries', 500)
  }
})
