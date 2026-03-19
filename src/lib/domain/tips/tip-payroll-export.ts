/**
 * Tip Payroll Export Domain Logic (Skill 251, updated Skill 270)
 *
 * Functions for aggregating tip data per employee over a date range,
 * broken down by source type, and formatting the result as a CSV
 * suitable for payroll processing.
 *
 * All data is read from TipLedgerEntry (immutable ledger entries) and
 * CashTipDeclaration records. No mutations occur in this module.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  CASH TIP DECLARATION RULE (Skill 270 — Double-Counting Guard)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The TipLedger is the SINGLE SOURCE OF TRUTH for all tip income.
 * Cash tips earned from orders flow into the ledger as DIRECT_TIP credits
 * just like card tips do. The ledger already includes cash tips.
 *
 * CashTipDeclaration records exist for IRS 8% compliance reporting ONLY.
 * They declare what an employee received in cash tips for tax purposes.
 * They are NOT a separate tip income source.
 *
 * Therefore:
 *   totalCompensation = wages + netTipsCents  (from ledger)
 *   cashDeclaredCents = informational / IRS field (NOT added to compensation)
 *
 * If a payroll processor sums both netTipsCents and cashDeclaredCents,
 * they WILL double-count cash tips. The CSV column header makes this clear.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { db } from '@/lib/db'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayrollEmployeeData {
  employeeId: string
  firstName: string
  lastName: string
  displayName: string | null
  roleName: string
  directTipsCents: number
  groupTipsCents: number
  roleTipOutsGivenCents: number
  roleTipOutsReceivedCents: number
  manualTransfersInCents: number
  manualTransfersOutCents: number
  chargebacksCents: number
  adjustmentsCents: number
  cashPayoutsCents: number
  payrollPayoutsCents: number
  netTipsCents: number
  cashDeclaredCents: number
  // Skill 277: Qualified Tips vs Service Charges
  qualifiedTipsCents: number    // Voluntary gratuities (kind = 'tip')
  serviceChargeCents: number    // Mandatory charges (kind = 'service_charge' | 'auto_gratuity')
}

export interface PayrollExportData {
  locationId: string
  periodStart: Date
  periodEnd: Date
  generatedAt: Date
  employees: PayrollEmployeeData[]
  totals: {
    totalDirectTipsCents: number
    totalGroupTipsCents: number
    totalNetTipsCents: number
    totalCashDeclaredCents: number
    // Skill 277: Qualified Tips vs Service Charges
    totalQualifiedTipsCents: number
    totalServiceChargeCents: number
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert an integer cents value to a formatted dollar string.
 *
 * @param cents - Amount in cents (may be negative)
 * @returns Formatted string, e.g. "45.00" or "-3.00"
 */
export function centsToDollarString(cents: number): string {
  const dollars = cents / 100
  return dollars.toFixed(2)
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Aggregate tip ledger data for payroll export.
 *
 * Queries all TipLedgerEntry records within the given date range and
 * location, groups them by employee and source type, then joins with
 * CashTipDeclaration for declared cash tips.
 *
 * @returns PayrollExportData with per-employee breakdowns and totals
 */
export async function aggregatePayrollData(params: {
  locationId: string
  periodStart: Date
  periodEnd: Date
}): Promise<PayrollExportData> {
  const { locationId, periodStart, periodEnd } = params

  // Fetch all ledger entries for the period
  const entries = await db.tipLedgerEntry.findMany({
    where: {
      locationId,
      deletedAt: null,
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    select: {
      employeeId: true,
      amountCents: true,
      type: true,
      sourceType: true,
    },
  })

  // Fetch cash tip declarations for the period
  const cashDeclarations = await db.cashTipDeclaration.findMany({
    where: {
      locationId,
      deletedAt: null,
      declaredAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    select: {
      employeeId: true,
      amountCents: true,
    },
  })

  // Skill 277: Aggregate TipTransaction amounts by employee and kind
  // This separates voluntary tips from mandatory service charges / auto-gratuities
  const tipTransactions = await db.tipTransaction.findMany({
    where: {
      locationId,
      deletedAt: null,
      collectedAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    select: {
      primaryEmployeeId: true,
      amountCents: true,
      kind: true,
    },
  })

  // Build per-employee qualified-tip vs service-charge maps
  const qualifiedTipsMap = new Map<string, number>()
  const serviceChargeMap = new Map<string, number>()
  for (const txn of tipTransactions) {
    if (!txn.primaryEmployeeId) continue
    const txnAmountCents = Number(txn.amountCents)
    if (txn.kind === 'service_charge' || txn.kind === 'auto_gratuity') {
      serviceChargeMap.set(
        txn.primaryEmployeeId,
        (serviceChargeMap.get(txn.primaryEmployeeId) || 0) + txnAmountCents,
      )
    } else {
      // 'tip' or null/undefined — treat as qualified tip
      qualifiedTipsMap.set(
        txn.primaryEmployeeId,
        (qualifiedTipsMap.get(txn.primaryEmployeeId) || 0) + txnAmountCents,
      )
    }
  }

  // Collect all unique employee IDs from both sources
  const employeeIds = new Set<string>()
  for (const entry of entries) {
    employeeIds.add(entry.employeeId)
  }
  for (const decl of cashDeclarations) {
    employeeIds.add(decl.employeeId)
  }

  // Fetch employee name + role data
  const employees = await db.employee.findMany({
    where: {
      id: { in: Array.from(employeeIds) },
      deletedAt: null,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      role: {
        select: {
          name: true,
        },
      },
    },
  })

  // Build a lookup map for employees
  const employeeMap = new Map<string, {
    firstName: string
    lastName: string
    displayName: string | null
    roleName: string
  }>()
  for (const emp of employees) {
    employeeMap.set(emp.id, {
      firstName: emp.firstName,
      lastName: emp.lastName,
      displayName: emp.displayName,
      roleName: emp.role.name,
    })
  }

  // Aggregate cash declarations by employee
  const cashDeclaredMap = new Map<string, number>()
  for (const decl of cashDeclarations) {
    const current = cashDeclaredMap.get(decl.employeeId) || 0
    cashDeclaredMap.set(decl.employeeId, current + Number(decl.amountCents))
  }

  // Aggregate ledger entries by employee and source type
  const aggregateMap = new Map<string, {
    directTipsCents: number
    groupTipsCents: number
    roleTipOutsGivenCents: number
    roleTipOutsReceivedCents: number
    manualTransfersInCents: number
    manualTransfersOutCents: number
    chargebacksCents: number
    adjustmentsCents: number
    cashPayoutsCents: number
    payrollPayoutsCents: number
    netTipsCents: number
  }>()

  const getOrCreateBucket = (empId: string) => {
    let bucket = aggregateMap.get(empId)
    if (!bucket) {
      bucket = {
        directTipsCents: 0,
        groupTipsCents: 0,
        roleTipOutsGivenCents: 0,
        roleTipOutsReceivedCents: 0,
        manualTransfersInCents: 0,
        manualTransfersOutCents: 0,
        chargebacksCents: 0,
        adjustmentsCents: 0,
        cashPayoutsCents: 0,
        payrollPayoutsCents: 0,
        netTipsCents: 0,
      }
      aggregateMap.set(empId, bucket)
    }
    return bucket
  }

  for (const entry of entries) {
    const bucket = getOrCreateBucket(entry.employeeId)
    const amt = Number(entry.amountCents) // signed: positive = credit, negative = debit

    // netTipsCents is the raw sum of all ledger entries for the period
    bucket.netTipsCents += amt

    switch (entry.sourceType) {
      case 'DIRECT_TIP':
        // Credits only (tips earned directly)
        bucket.directTipsCents += amt
        break

      case 'TIP_GROUP':
        // Credits from group/pool distributions
        bucket.groupTipsCents += amt
        break

      case 'ROLE_TIPOUT':
        if (amt < 0) {
          // Debit = tip-out given (store as positive for readability)
          bucket.roleTipOutsGivenCents += Math.abs(amt)
        } else {
          // Credit = tip-out received
          bucket.roleTipOutsReceivedCents += amt
        }
        break

      case 'MANUAL_TRANSFER':
        if (amt < 0) {
          // Debit = transfer out (store as positive)
          bucket.manualTransfersOutCents += Math.abs(amt)
        } else {
          // Credit = transfer in
          bucket.manualTransfersInCents += amt
        }
        break

      case 'CHARGEBACK':
        // Debits (store as positive)
        bucket.chargebacksCents += Math.abs(amt)
        break

      case 'ADJUSTMENT':
        // Can be positive or negative
        bucket.adjustmentsCents += amt
        break

      case 'PAYOUT_CASH':
        // Debits (store as positive)
        bucket.cashPayoutsCents += Math.abs(amt)
        break

      case 'PAYOUT_PAYROLL':
        // Debits (store as positive)
        bucket.payrollPayoutsCents += Math.abs(amt)
        break
    }
  }

  // Build the result array
  const payrollEmployees: PayrollEmployeeData[] = []

  for (const empId of employeeIds) {
    const empInfo = employeeMap.get(empId)
    if (!empInfo) continue // Employee was deleted or not found

    const bucket = getOrCreateBucket(empId)
    const cashDeclared = cashDeclaredMap.get(empId) || 0

    payrollEmployees.push({
      employeeId: empId,
      firstName: empInfo.firstName,
      lastName: empInfo.lastName,
      displayName: empInfo.displayName,
      roleName: empInfo.roleName,
      directTipsCents: bucket.directTipsCents,
      groupTipsCents: bucket.groupTipsCents,
      roleTipOutsGivenCents: bucket.roleTipOutsGivenCents,
      roleTipOutsReceivedCents: bucket.roleTipOutsReceivedCents,
      manualTransfersInCents: bucket.manualTransfersInCents,
      manualTransfersOutCents: bucket.manualTransfersOutCents,
      chargebacksCents: bucket.chargebacksCents,
      adjustmentsCents: bucket.adjustmentsCents,
      cashPayoutsCents: bucket.cashPayoutsCents,
      payrollPayoutsCents: bucket.payrollPayoutsCents,
      netTipsCents: bucket.netTipsCents,
      cashDeclaredCents: cashDeclared,
      // Skill 277: Qualified Tips vs Service Charges
      qualifiedTipsCents: qualifiedTipsMap.get(empId) || 0,
      serviceChargeCents: serviceChargeMap.get(empId) || 0,
    })
  }

  // Sort by last name, then first name for consistent ordering
  payrollEmployees.sort((a, b) => {
    const lastCmp = a.lastName.localeCompare(b.lastName)
    if (lastCmp !== 0) return lastCmp
    return a.firstName.localeCompare(b.firstName)
  })

  // Compute totals
  const totals = {
    totalDirectTipsCents: 0,
    totalGroupTipsCents: 0,
    totalNetTipsCents: 0,
    totalCashDeclaredCents: 0,
    // Skill 277: Qualified Tips vs Service Charges
    totalQualifiedTipsCents: 0,
    totalServiceChargeCents: 0,
  }

  for (const emp of payrollEmployees) {
    totals.totalDirectTipsCents += emp.directTipsCents
    totals.totalGroupTipsCents += emp.groupTipsCents
    totals.totalNetTipsCents += emp.netTipsCents
    totals.totalCashDeclaredCents += emp.cashDeclaredCents
    totals.totalQualifiedTipsCents += emp.qualifiedTipsCents
    totals.totalServiceChargeCents += emp.serviceChargeCents
  }

  return {
    locationId,
    periodStart,
    periodEnd,
    generatedAt: new Date(),
    employees: payrollEmployees,
    totals,
  }
}

// ─── CSV Formatting ──────────────────────────────────────────────────────────

/**
 * Format payroll export data as a CSV string.
 *
 * Pure function with no side effects. Includes a period header row,
 * column headers, one data row per employee, and a totals row.
 * All monetary values are converted from cents to dollars (2 decimal places).
 *
 * @param data - The aggregated payroll data from aggregatePayrollData()
 * @returns Complete CSV string ready for download or file write
 */
export function formatPayrollCSV(data: PayrollExportData): string {
  const lines: string[] = []

  // Period header
  const startStr = data.periodStart.toISOString().split('T')[0]
  const endStr = data.periodEnd.toISOString().split('T')[0]
  lines.push(`Payroll Export — ${startStr} to ${endStr}`)
  lines.push('') // blank line separator

  // Column headers
  lines.push([
    'Employee ID',
    'First Name',
    'Last Name',
    'Display Name',
    'Role',
    'Direct Tips',
    'Group Tips',
    'Tip-Outs Given',
    'Tip-Outs Received',
    'Transfers In',
    'Transfers Out',
    'Chargebacks',
    'Adjustments',
    'Cash Payouts',
    'Payroll Payouts',
    'Net Tips (Compensation)',
    'Qualified Tips (Voluntary)',
    'Service Charges (Mandatory)',
    'Cash Declared (IRS Only - DO NOT add to compensation)',
  ].join(','))

  // Employee data rows
  for (const emp of data.employees) {
    lines.push([
      csvEscape(emp.employeeId),
      csvEscape(emp.firstName),
      csvEscape(emp.lastName),
      csvEscape(emp.displayName || ''),
      csvEscape(emp.roleName),
      centsToDollarString(emp.directTipsCents),
      centsToDollarString(emp.groupTipsCents),
      centsToDollarString(emp.roleTipOutsGivenCents),
      centsToDollarString(emp.roleTipOutsReceivedCents),
      centsToDollarString(emp.manualTransfersInCents),
      centsToDollarString(emp.manualTransfersOutCents),
      centsToDollarString(emp.chargebacksCents),
      centsToDollarString(emp.adjustmentsCents),
      centsToDollarString(emp.cashPayoutsCents),
      centsToDollarString(emp.payrollPayoutsCents),
      centsToDollarString(emp.netTipsCents),
      centsToDollarString(emp.qualifiedTipsCents),
      centsToDollarString(emp.serviceChargeCents),
      centsToDollarString(emp.cashDeclaredCents),
    ].join(','))
  }

  // Totals row
  lines.push([
    '',
    '',
    '',
    '',
    'TOTALS',
    centsToDollarString(data.totals.totalDirectTipsCents),
    centsToDollarString(data.totals.totalGroupTipsCents),
    '', // tip-outs given total not in top-level totals
    '', // tip-outs received total not in top-level totals
    '', // transfers in total not in top-level totals
    '', // transfers out total not in top-level totals
    '', // chargebacks total not in top-level totals
    '', // adjustments total not in top-level totals
    '', // cash payouts total not in top-level totals
    '', // payroll payouts total not in top-level totals
    centsToDollarString(data.totals.totalNetTipsCents),
    centsToDollarString(data.totals.totalQualifiedTipsCents),
    centsToDollarString(data.totals.totalServiceChargeCents),
    centsToDollarString(data.totals.totalCashDeclaredCents),
  ].join(','))

  return lines.join('\n')
}

/**
 * Escape a string value for CSV output.
 * Wraps in double quotes if the value contains a comma, quote, or newline.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
