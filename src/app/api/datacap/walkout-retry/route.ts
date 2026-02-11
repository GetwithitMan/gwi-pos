import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { parseSettings } from '@/lib/settings'

// POST - Retry capture for a walkout tab (manual trigger)
// Also used by cron/scheduler for auto-retry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { walkoutRetryId, employeeId } = body

    if (!walkoutRetryId) {
      return NextResponse.json({ error: 'Missing walkoutRetryId' }, { status: 400 })
    }

    const retry = await db.walkoutRetry.findFirst({
      where: { id: walkoutRetryId, deletedAt: null, status: 'pending' },
    })

    if (!retry) {
      return NextResponse.json({ error: 'Walkout retry not found or already resolved' }, { status: 404 })
    }

    // Get the order card to retry against
    const orderCard = await db.orderCard.findFirst({
      where: { id: retry.orderCardId, deletedAt: null },
    })

    if (!orderCard) {
      return NextResponse.json({ error: 'Order card not found' }, { status: 404 })
    }

    const locationId = retry.locationId
    const settings = parseSettings(
      (await db.location.findUnique({ where: { id: locationId }, select: { settings: true } }))?.settings
    )
    const { walkoutRetryFrequencyDays, walkoutMaxRetryDays } = settings.payments

    try {
      await validateReader(orderCard.readerId, locationId)
      const client = await requireDatacapClient(locationId)

      const response = await client.preAuthCapture(orderCard.readerId, {
        recordNo: orderCard.recordNo,
        purchaseAmount: Number(retry.amount),
      })

      const error = parseError(response)
      const approved = response.cmdStatus === 'Approved'
      const now = new Date()

      if (approved) {
        // Update retry as collected
        await db.$transaction([
          db.walkoutRetry.update({
            where: { id: walkoutRetryId },
            data: {
              status: 'collected',
              collectedAt: now,
              lastRetryAt: now,
              retryCount: retry.retryCount + 1,
            },
          }),
          db.orderCard.update({
            where: { id: orderCard.id },
            data: {
              status: 'captured',
              capturedAmount: Number(retry.amount),
              capturedAt: now,
            },
          }),
        ])

        return NextResponse.json({
          data: {
            success: true,
            status: 'collected',
            amount: Number(retry.amount),
            authCode: response.authCode,
          },
        })
      } else {
        // Calculate next retry
        const nextRetry = new Date(now)
        nextRetry.setDate(nextRetry.getDate() + walkoutRetryFrequencyDays)

        const createdAt = new Date(retry.createdAt)
        const maxDate = new Date(createdAt)
        maxDate.setDate(maxDate.getDate() + walkoutMaxRetryDays)

        const exhausted = nextRetry > maxDate

        await db.walkoutRetry.update({
          where: { id: walkoutRetryId },
          data: {
            retryCount: retry.retryCount + 1,
            lastRetryAt: now,
            lastRetryError: error?.text || response.textResponse || 'Declined',
            status: exhausted ? 'exhausted' : 'pending',
            nextRetryAt: exhausted ? retry.nextRetryAt : nextRetry,
          },
        })

        return NextResponse.json({
          data: {
            success: false,
            status: exhausted ? 'exhausted' : 'pending',
            retryCount: retry.retryCount + 1,
            nextRetryAt: exhausted ? null : nextRetry.toISOString(),
            error: error ? { code: error.code, message: error.text } : null,
          },
        })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Retry failed'

      await db.walkoutRetry.update({
        where: { id: walkoutRetryId },
        data: {
          retryCount: retry.retryCount + 1,
          lastRetryAt: new Date(),
          lastRetryError: errorMsg,
        },
      })

      return NextResponse.json({
        data: { success: false, error: errorMsg },
      })
    }
  } catch (error) {
    console.error('Failed to process walkout retry:', error)
    return NextResponse.json({ error: 'Failed to process walkout retry' }, { status: 500 })
  }
}

// GET - List walkout retries for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status') // pending | collected | exhausted | written_off

    if (!locationId) {
      return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
    }

    const where: Record<string, unknown> = { locationId, deletedAt: null }
    if (status) where.status = status

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

    return NextResponse.json({
      data: retries.map(r => {
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
      }),
    })
  } catch (error) {
    console.error('Failed to list walkout retries:', error)
    return NextResponse.json({ error: 'Failed to list walkout retries' }, { status: 500 })
  }
}
