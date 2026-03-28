/**
 * Gift Card Export API
 *
 * GET /api/gift-cards/export?type=cards|transactions&locationId=...&dateFrom=...&dateTo=...
 *
 * Streams a CSV file with Content-Disposition attachment header.
 * Two export modes:
 *   - cards: All gift cards with status, balances, recipient info, transaction count
 *   - transactions: All transactions with card number, type, amount, balances
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { err } from '@/lib/api-response'

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatDateISO(date: Date | string | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString()
}

export const GET = withVenue(withAuth('CUSTOMERS_GIFT_CARDS', async function GET(
  request: NextRequest,
  _ctx: AuthenticatedContext
) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'cards'
    const locationId = searchParams.get('locationId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!locationId) {
      return err('locationId is required')
    }

    if (type !== 'cards' && type !== 'transactions') {
      return err('type must be "cards" or "transactions"')
    }

    const dateFilter: Record<string, Date> = {}
    if (dateFrom) dateFilter.gte = new Date(dateFrom)
    if (dateTo) dateFilter.lte = new Date(dateTo)

    const today = new Date().toISOString().split('T')[0]
    const filename = type === 'cards'
      ? `gift-cards-${today}.csv`
      : `gift-card-transactions-${today}.csv`

    if (type === 'cards') {
      // ── Cards export ──────────────────────────────────────────────
      const where: Record<string, unknown> = { locationId, deletedAt: null }
      if (dateFrom || dateTo) {
        where.createdAt = dateFilter
      }

      const cards = await db.giftCard.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { transactions: true } },
        },
      })

      const header = 'cardNumber,status,initialBalance,currentBalance,recipientName,recipientEmail,purchaserName,source,createdAt,transactionCount\n'
      const rows = cards.map(card =>
        [
          escapeCSV(card.cardNumber),
          escapeCSV(card.status),
          Number(card.initialBalance).toFixed(2),
          Number(card.currentBalance).toFixed(2),
          escapeCSV(card.recipientName),
          escapeCSV(card.recipientEmail),
          escapeCSV(card.purchaserName),
          escapeCSV(card.source),
          formatDateISO(card.createdAt),
          String(card._count.transactions),
        ].join(',')
      ).join('\n')

      const csv = header + rows

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    } else {
      // ── Transactions export ───────────────────────────────────────
      const where: Record<string, unknown> = { locationId }
      if (dateFrom || dateTo) {
        where.createdAt = dateFilter
      }

      const transactions = await db.giftCardTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          giftCard: { select: { cardNumber: true } },
        },
      })

      const header = 'cardNumber,type,amount,balanceBefore,balanceAfter,notes,createdAt\n'
      const rows = transactions.map(t =>
        [
          escapeCSV(t.giftCard?.cardNumber),
          escapeCSV(t.type),
          Number(t.amount).toFixed(2),
          Number(t.balanceBefore).toFixed(2),
          Number(t.balanceAfter).toFixed(2),
          escapeCSV(t.notes),
          formatDateISO(t.createdAt),
        ].join(',')
      ).join('\n')

      const csv = header + rows

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }
  } catch (error) {
    console.error('Failed to export gift cards:', error)
    return err('Failed to export gift cards', 500)
  }
}))
