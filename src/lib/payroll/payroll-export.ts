/**
 * Payroll Data Generator
 *
 * Aggregates time clock entries, tips, breaks, and commissions per employee
 * for a given date range. Returns PayrollRecord[] ready for formatting.
 *
 * TODO: Migrate to repositories. This file takes db: PrismaClient as a param
 * and runs multiple aggregate queries with date ranges and employee batch lookups.
 * Requires new repo methods for:
 * - PaymentRepository: findMany by employeeId batch + paymentMethod + date range
 * - OrderRepository: findMany by employeeId batch + paidAt date range + commissionTotal
 * - No repos exist for: TimeClockEntry, Break, TipLedgerEntry, TipLedger
 */

import type { PrismaClient } from '@/generated/prisma/client'

export interface PayrollRecord {
  employeeId: string
  employeeName: string
  role: string
  hourlyRate: number | null

  // Time clock
  regularHours: number
  overtimeHours: number
  totalHours: number

  // Breaks
  breakHoursPaid: number
  breakHoursUnpaid: number

  // Tips
  cashTipsDeclared: number
  cardTipsReceived: number
  tipOutsGiven: number
  tipOutsReceived: number
  tipBankBalance: number
  totalTipCompensation: number

  // Commission
  commissionEarned: number

  // Employee meals (if tracked for payroll)
  employeeMealsValue: number

  // Computed
  grossRegularPay: number
  grossOvertimePay: number
  grossPay: number
}

/**
 * Generate payroll data for all employees with activity in the given date range.
 */
export async function generatePayrollData(
  db: PrismaClient,
  locationId: string,
  startDate: Date,
  endDate: Date,
): Promise<PayrollRecord[]> {
  // Fetch all time clock entries in range
  const timeClockEntries = await db.timeClockEntry.findMany({
    where: {
      locationId,
      clockIn: { gte: startDate },
      clockOut: { lte: endDate, not: null },
      deletedAt: null,
    },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          hourlyRate: true,
          role: { select: { name: true } },
        },
      },
    },
  })

  // Gather unique employee IDs from time clock entries
  const employeeIds = [...new Set(timeClockEntries.map(e => e.employeeId))]
  if (employeeIds.length === 0) return []

  // Fetch break records for these entries
  const entryIds = timeClockEntries.map(e => e.id)
  const breaks = await db.break.findMany({
    where: {
      timeClockEntryId: { in: entryIds },
      status: 'completed',
      deletedAt: null,
    },
    select: {
      employeeId: true,
      breakType: true,
      duration: true,
    },
  })

  // Fetch tip ledger entries for employees in range
  const tipEntries = await db.tipLedgerEntry.findMany({
    where: {
      locationId,
      employeeId: { in: employeeIds },
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    },
    select: {
      employeeId: true,
      type: true,
      amountCents: true,
      sourceType: true,
    },
  })

  // Fetch tip ledger balances (current)
  const tipLedgers = await db.tipLedger.findMany({
    where: {
      locationId,
      employeeId: { in: employeeIds },
    },
    select: {
      employeeId: true,
      currentBalanceCents: true,
    },
  })

  // Fetch commission data: sum of commissionTotal on paid orders by employee in range
  const commissionOrders = await db.order.findMany({
    where: {
      locationId,
      employeeId: { in: employeeIds },
      paidAt: { gte: startDate, lte: endDate },
      commissionTotal: { gt: 0 },
      deletedAt: null,
    },
    select: {
      employeeId: true,
      commissionTotal: true,
    },
  })

  // Fetch cash tips declared on payments (tips on cash payments)
  const cashTipPayments = await db.payment.findMany({
    where: {
      locationId,
      employeeId: { in: employeeIds },
      paymentMethod: 'cash',
      tipAmount: { gt: 0 },
      status: 'completed',
      processedAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    },
    select: {
      employeeId: true,
      tipAmount: true,
    },
  })

  // Build per-employee aggregates
  const records = new Map<string, PayrollRecord>()

  for (const entry of timeClockEntries) {
    const emp = entry.employee
    const empId = emp.id

    if (!records.has(empId)) {
      records.set(empId, {
        employeeId: empId,
        employeeName: emp.displayName || `${emp.firstName} ${emp.lastName}`,
        role: emp.role.name,
        hourlyRate: emp.hourlyRate ? Number(emp.hourlyRate) : null,
        regularHours: 0,
        overtimeHours: 0,
        totalHours: 0,
        breakHoursPaid: 0,
        breakHoursUnpaid: 0,
        cashTipsDeclared: 0,
        cardTipsReceived: 0,
        tipOutsGiven: 0,
        tipOutsReceived: 0,
        tipBankBalance: 0,
        totalTipCompensation: 0,
        commissionEarned: 0,
        employeeMealsValue: 0,
        grossRegularPay: 0,
        grossOvertimePay: 0,
        grossPay: 0,
      })
    }

    const rec = records.get(empId)!
    rec.regularHours += Number(entry.regularHours) || 0
    rec.overtimeHours += Number(entry.overtimeHours) || 0
  }

  // Aggregate breaks
  for (const b of breaks) {
    const rec = records.get(b.employeeId)
    if (!rec) continue
    const hours = (b.duration || 0) / 60
    if (b.breakType === 'paid') {
      rec.breakHoursPaid += hours
    } else {
      rec.breakHoursUnpaid += hours
    }
  }

  // Aggregate tip ledger entries
  for (const t of tipEntries) {
    const rec = records.get(t.employeeId)
    if (!rec) continue
    const amount = Number(t.amountCents) / 100 // amountCents stored as dollar in Decimal(10,2)
    // Note: TipLedgerEntry.amountCents is stored as dollars despite the name (Decimal 10,2)

    if (t.sourceType === 'DIRECT_TIP' && t.type === 'CREDIT') {
      rec.cardTipsReceived += amount
    } else if (t.sourceType === 'ROLE_TIPOUT' || t.sourceType === 'TIP_GROUP') {
      if (t.type === 'DEBIT') {
        rec.tipOutsGiven += Math.abs(amount)
      } else {
        rec.tipOutsReceived += amount
      }
    }
  }

  // Tip bank balances
  for (const tl of tipLedgers) {
    const rec = records.get(tl.employeeId)
    if (rec) {
      rec.tipBankBalance = Number(tl.currentBalanceCents) / 100
    }
  }

  // Cash tips declared
  for (const p of cashTipPayments) {
    if (!p.employeeId) continue
    const rec = records.get(p.employeeId)
    if (rec) {
      rec.cashTipsDeclared += Number(p.tipAmount)
    }
  }

  // Commission
  for (const o of commissionOrders) {
    if (!o.employeeId) continue
    const rec = records.get(o.employeeId)
    if (rec) {
      rec.commissionEarned += Number(o.commissionTotal)
    }
  }

  // Compute totals
  for (const rec of records.values()) {
    rec.totalHours = rec.regularHours + rec.overtimeHours
    rec.totalTipCompensation = rec.cashTipsDeclared + rec.cardTipsReceived + rec.tipOutsReceived - rec.tipOutsGiven
    const rate = rec.hourlyRate || 0
    rec.grossRegularPay = Math.round(rec.regularHours * rate * 100) / 100
    rec.grossOvertimePay = Math.round(rec.overtimeHours * rate * 1.5 * 100) / 100
    rec.grossPay = rec.grossRegularPay + rec.grossOvertimePay

    // Round hours to 2 decimals
    rec.regularHours = Math.round(rec.regularHours * 100) / 100
    rec.overtimeHours = Math.round(rec.overtimeHours * 100) / 100
    rec.totalHours = Math.round(rec.totalHours * 100) / 100
    rec.breakHoursPaid = Math.round(rec.breakHoursPaid * 100) / 100
    rec.breakHoursUnpaid = Math.round(rec.breakHoursUnpaid * 100) / 100
    rec.cashTipsDeclared = Math.round(rec.cashTipsDeclared * 100) / 100
    rec.cardTipsReceived = Math.round(rec.cardTipsReceived * 100) / 100
    rec.tipOutsGiven = Math.round(rec.tipOutsGiven * 100) / 100
    rec.tipOutsReceived = Math.round(rec.tipOutsReceived * 100) / 100
    rec.totalTipCompensation = Math.round(rec.totalTipCompensation * 100) / 100
    rec.commissionEarned = Math.round(rec.commissionEarned * 100) / 100
  }

  // Sort by employee name
  return [...records.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}
