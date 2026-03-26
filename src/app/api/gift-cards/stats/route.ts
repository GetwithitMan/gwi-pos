/**
 * Gift Card Stats API
 *
 * GET /api/gift-cards/stats?locationId=...
 *
 * Returns aggregated statistics: total liability, status counts,
 * and the 5 most recent transactions across all cards at the location.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // ── Run all queries in parallel ──────────────────────────────────────
    const [
      activeAgg,
      frozenAgg,
      activeCount,
      depletedCount,
      frozenCount,
      expiredCount,
      unactivatedCount,
      recentTransactions,
    ] = await Promise.all([
      // Sum of active card balances (liability)
      db.giftCard.aggregate({
        where: { locationId, status: 'active', deletedAt: null },
        _sum: { currentBalance: true },
      }),
      // Sum of frozen card balances (also liability — funds are held)
      db.giftCard.aggregate({
        where: { locationId, status: 'frozen', deletedAt: null },
        _sum: { currentBalance: true },
      }),
      // Status counts
      db.giftCard.count({
        where: { locationId, status: 'active', deletedAt: null },
      }),
      db.giftCard.count({
        where: { locationId, status: 'depleted', deletedAt: null },
      }),
      db.giftCard.count({
        where: { locationId, status: 'frozen', deletedAt: null },
      }),
      db.giftCard.count({
        where: { locationId, status: 'expired', deletedAt: null },
      }),
      db.giftCard.count({
        where: { locationId, status: 'unactivated', deletedAt: null },
      }),
      // Last 5 transactions across all cards at this location
      db.giftCardTransaction.findMany({
        where: { locationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          giftCard: {
            select: { cardNumber: true },
          },
        },
      }),
    ])

    const activeLiability = Number(activeAgg._sum.currentBalance ?? 0)
    const frozenLiability = Number(frozenAgg._sum.currentBalance ?? 0)
    const totalLiability = activeLiability + frozenLiability

    return NextResponse.json({
      totalLiability,
      activeCount,
      depletedCount,
      frozenCount,
      expiredCount,
      unactivatedCount,
      recentTransactions: recentTransactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        notes: t.notes,
        createdAt: t.createdAt,
        cardNumber: t.giftCard?.cardNumber ?? null,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch gift card stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch gift card stats' },
      { status: 500 }
    )
  }
})
