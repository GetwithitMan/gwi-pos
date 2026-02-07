import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'

// POST - Mark an open tab as a walkout and create retry records
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { employeeId } = body

    if (!employeeId) {
      return NextResponse.json({ error: 'Missing required field: employeeId' }, { status: 400 })
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
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.cards.length === 0) {
      return NextResponse.json({ error: 'No authorized cards on this tab to retry' }, { status: 400 })
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
      },
    })

    // Create walkout retry records for each authorized card
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

    console.log(`[Walkout] Order=${orderId} Amount=$${tabAmount} Cards=${order.cards.length} RetryEnabled=${walkoutRetryEnabled} Employee=${employeeId}`)

    return NextResponse.json({
      data: {
        success: true,
        walkoutAt: now.toISOString(),
        amount: tabAmount,
        retries,
        retryEnabled: walkoutRetryEnabled,
      },
    })
  } catch (error) {
    console.error('Failed to mark walkout:', error)
    return NextResponse.json({ error: 'Failed to mark walkout' }, { status: 500 })
  }
}
