import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // 1. Cash on hand from active drawers (paid in/out)
    const paidInOuts = await db.paidInOut.findMany({
      where: { locationId },
      select: { type: true, amount: true },
    })

    let totalCashIn = 0
    let totalCashOut = 0
    for (const pio of paidInOuts) {
      if (pio.type === 'in') totalCashIn += Number(pio.amount)
      else totalCashOut += Number(pio.amount)
    }

    // Cash from active shifts (starting cash + cash sales)
    const activeShifts = await db.shift.findMany({
      where: {
        locationId,
        endedAt: null,
      },
      select: {
        id: true,
        startingCash: true,
        cashSales: true,
        employeeId: true,
        employee: { select: { firstName: true, lastName: true, displayName: true } },
      },
    })

    const cashDrawers = activeShifts.map(s => ({
      shiftId: s.id,
      employee: s.employee.displayName || `${s.employee.firstName} ${s.employee.lastName}`,
      startingCash: Number(s.startingCash || 0),
      cashSales: Number(s.cashSales || 0),
      estimated: Number(s.startingCash || 0) + Number(s.cashSales || 0),
    }))

    const totalCashOnHand = cashDrawers.reduce((sum, d) => sum + d.estimated, 0) + totalCashIn - totalCashOut

    // 2. House account balances
    const houseAccounts = await db.houseAccount.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        currentBalance: true,
        creditLimit: true,
      },
    })

    const totalHouseAccountBalance = houseAccounts.reduce((sum, ha) => sum + Number(ha.currentBalance), 0)

    // 3. Gift card balances
    const giftCards = await db.giftCard.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: 'active',
      },
      select: {
        id: true,
        cardNumber: true,
        currentBalance: true,
      },
    })

    const totalGiftCardBalance = giftCards.reduce((sum, gc) => sum + Number(gc.currentBalance), 0)

    // 4. Unpaid tip balances from TipLedger
    const tipLedgers = await db.tipLedger.findMany({
      where: {
        locationId,
        deletedAt: null,
      },
      include: {
        employee: { select: { firstName: true, lastName: true, displayName: true } },
      },
    })

    const tipBalances = tipLedgers
      .filter(tl => tl.currentBalanceCents > 0)
      .map(tl => ({
        employeeId: tl.employeeId,
        employee: tl.employee.displayName || `${tl.employee.firstName} ${tl.employee.lastName}`,
        balance: tl.currentBalanceCents / 100,
      }))

    const totalTipBalance = tipBalances.reduce((sum, tb) => sum + tb.balance, 0)

    // 5. Closed shift variances (over/short)
    const closedShifts = await db.shift.findMany({
      where: {
        locationId,
        endedAt: { not: null },
        variance: { not: null },
      },
      orderBy: { endedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        variance: true,
        endedAt: true,
        employee: { select: { firstName: true, lastName: true, displayName: true } },
      },
    })

    const recentVariances = closedShifts.map(s => ({
      shiftId: s.id,
      employee: s.employee.displayName || `${s.employee.firstName} ${s.employee.lastName}`,
      variance: Number(s.variance),
      date: s.endedAt,
    }))

    const totalVariance = recentVariances.reduce((sum, v) => sum + v.variance, 0)

    // Totals
    const totalLiabilities = totalHouseAccountBalance + totalGiftCardBalance + totalTipBalance
    const netPosition = totalCashOnHand - totalLiabilities

    return NextResponse.json({
      data: {
        cash: {
          totalOnHand: totalCashOnHand,
          paidIn: totalCashIn,
          paidOut: totalCashOut,
          drawers: cashDrawers,
        },
        houseAccounts: {
          total: totalHouseAccountBalance,
          count: houseAccounts.length,
          accounts: houseAccounts.map(ha => ({
            id: ha.id,
            name: ha.name,
            balance: Number(ha.currentBalance),
            creditLimit: Number(ha.creditLimit),
          })),
        },
        giftCards: {
          total: totalGiftCardBalance,
          count: giftCards.length,
          activeCount: giftCards.filter(gc => Number(gc.currentBalance) > 0).length,
          cards: giftCards.filter(gc => Number(gc.currentBalance) > 0).map(gc => ({
            id: gc.id,
            cardNumber: gc.cardNumber,
            balance: Number(gc.currentBalance),
          })),
        },
        tips: {
          total: totalTipBalance,
          balances: tipBalances,
        },
        variance: {
          total: totalVariance,
          recent: recentVariances,
        },
        totals: {
          totalCash: totalCashOnHand,
          totalLiabilities,
          netPosition,
        },
      },
    })
  } catch (error) {
    console.error('Cash liabilities report error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
})
