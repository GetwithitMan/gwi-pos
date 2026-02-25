import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { HouseAccountStatus } from '@prisma/client'
import { withVenue } from '@/lib/with-venue'

// GET - House Accounts Aging Report (P1-03)
// Returns all accounts with balances grouped by how long they have been outstanding.
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const statusFilter = (searchParams.get('status') || 'active') as HouseAccountStatus
    const includeZeroBalance = searchParams.get('includeZeroBalance') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const today = new Date()

    // Fetch all matching house accounts, including their charge and payment transactions
    const accounts = await db.houseAccount.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: statusFilter,
      },
      include: {
        // All charge transactions (for aging bucket calculation)
        transactions: {
          where: {
            deletedAt: null,
            type: 'charge',
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Fetch the last payment transaction per account in a single query
    // (grouped by houseAccountId, ordered by createdAt desc, take 1 each)
    const lastPayments = await db.houseAccountTransaction.findMany({
      where: {
        locationId,
        deletedAt: null,
        type: 'payment',
        houseAccountId: { in: accounts.map(a => a.id) },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['houseAccountId'],
      select: {
        houseAccountId: true,
        createdAt: true,
        amount: true,
      },
    })

    // Build a lookup map: houseAccountId → last payment record
    const lastPaymentMap = new Map(lastPayments.map(p => [p.houseAccountId, p]))

    // Helper: calculate days between two dates (positive = overdue)
    function daysBetween(from: Date, to: Date): number {
      const msPerDay = 1000 * 60 * 60 * 24
      return Math.floor((to.getTime() - from.getTime()) / msPerDay)
    }

    // Helper: assign aging bucket label from daysOverdue
    function agingBucket(daysOverdue: number): 'current' | '30' | '60' | '90' | 'over90' {
      if (daysOverdue <= 0) return 'current'
      if (daysOverdue <= 30) return '30'
      if (daysOverdue <= 60) return '60'
      if (daysOverdue <= 90) return '90'
      return 'over90'
    }

    // Summary accumulators
    let totalOutstanding = 0
    let totalCurrent = 0
    let total30 = 0
    let total60 = 0
    let total90 = 0
    let totalOver90 = 0
    let overdueCount = 0

    const accountRows = accounts
      .filter(account => {
        const balance = Number(account.currentBalance)
        return includeZeroBalance || balance > 0
      })
      .map(account => {
        const currentBalance = Number(account.currentBalance)
        const creditLimit = Number(account.creditLimit)
        const paymentTerms = account.paymentTerms // days

        // Last payment info
        const lastPayment = lastPaymentMap.get(account.id)
        const lastPaymentDate = lastPayment ? lastPayment.createdAt.toISOString() : null
        const lastPaymentAmount = lastPayment ? Math.abs(Number(lastPayment.amount)) : null

        // Find the oldest charge transaction to determine aging
        // (Simplified approach: put entire currentBalance in one bucket based on oldest charge dueDate)
        let oldestChargeDate: string | null = null
        let daysOverdue = 0

        if (account.transactions.length > 0 && currentBalance > 0) {
          // Transactions are already sorted oldest-first (orderBy: createdAt asc)
          const oldestCharge = account.transactions[0]

          // Determine the due date: use dueDate if set, otherwise createdAt + paymentTerms
          let dueDate: Date
          if (oldestCharge.dueDate) {
            dueDate = oldestCharge.dueDate
          } else {
            dueDate = new Date(oldestCharge.createdAt)
            dueDate.setDate(dueDate.getDate() + paymentTerms)
          }

          oldestChargeDate = oldestCharge.createdAt.toISOString()
          daysOverdue = daysBetween(dueDate, today)
        }

        const bucket = agingBucket(daysOverdue)

        // Place the entire balance in the correct bucket
        const bucketCurrent = bucket === 'current' ? currentBalance : 0
        const bucket30 = bucket === '30' ? currentBalance : 0
        const bucket60 = bucket === '60' ? currentBalance : 0
        const bucket90 = bucket === '90' ? currentBalance : 0
        const bucketOver90 = bucket === 'over90' ? currentBalance : 0

        // Accumulate summary totals
        totalOutstanding += currentBalance
        totalCurrent += bucketCurrent
        total30 += bucket30
        total60 += bucket60
        total90 += bucket90
        totalOver90 += bucketOver90
        if (daysOverdue > 0) overdueCount += 1

        return {
          id: account.id,
          name: account.name,
          contactName: account.contactName ?? null,
          email: account.email ?? null,
          phone: account.phone ?? null,
          currentBalance,
          creditLimit,
          paymentTerms,
          status: account.status,
          lastPaymentDate,
          lastPaymentAmount,
          oldestChargeDate,
          daysOverdue,
          agingBucket: bucket,
          current: bucketCurrent,
          bucket30,
          bucket60,
          bucket90,
          over90: bucketOver90,
        }
      })

    const summary = {
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalCurrent: Math.round(totalCurrent * 100) / 100,
      total30: Math.round(total30 * 100) / 100,
      total60: Math.round(total60 * 100) / 100,
      total90: Math.round(total90 * 100) / 100,
      totalOver90: Math.round(totalOver90 * 100) / 100,
      accountCount: accountRows.length,
      overdueCount,
    }

    return NextResponse.json({
      data: {
        accounts: accountRows,
        summary,
      },
    })
  } catch (error) {
    console.error('Failed to generate house accounts aging report:', error)
    return NextResponse.json(
      { error: 'Failed to generate house accounts aging report' },
      { status: 500 }
    )
  }
})
