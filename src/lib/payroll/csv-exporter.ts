/**
 * Payroll CSV Exporter
 *
 * Formats PayrollRecord[] into CSV strings compatible with various
 * payroll providers (ADP, Gusto, Paychex, generic CSV).
 */

import type { PayrollRecord } from './payroll-export'

function escCsv(val: string | number): string {
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function row(fields: (string | number)[]): string {
  return fields.map(escCsv).join(',')
}

/**
 * Standard payroll CSV — compatible with most payroll import tools.
 */
export function toGenericCsv(records: PayrollRecord[], startDate: string, endDate: string): string {
  const header = row([
    'Employee ID',
    'Employee Name',
    'Role',
    'Hourly Rate',
    'Regular Hours',
    'OT Hours',
    'Total Hours',
    'Break Hours (Paid)',
    'Break Hours (Unpaid)',
    'Cash Tips',
    'Card Tips',
    'Tip Outs Given',
    'Tip Outs Received',
    'Total Tips',
    'Commission',
    'Gross Regular Pay',
    'Gross OT Pay',
    'Gross Pay',
  ])

  const rows = records.map(r => row([
    r.employeeId,
    r.employeeName,
    r.role,
    r.hourlyRate ?? 0,
    r.regularHours,
    r.overtimeHours,
    r.totalHours,
    r.breakHoursPaid,
    r.breakHoursUnpaid,
    r.cashTipsDeclared,
    r.cardTipsReceived,
    r.tipOutsGiven,
    r.tipOutsReceived,
    r.totalTipCompensation,
    r.commissionEarned,
    r.grossRegularPay,
    r.grossOvertimePay,
    r.grossPay,
  ]))

  return `# Payroll Export: ${startDate} to ${endDate}\n${header}\n${rows.join('\n')}\n`
}

/**
 * ADP-compatible CSV format.
 * ADP Run/Workforce imports: Co Code, Batch ID, File #, Reg Hours, OT Hours, Tips, Commission
 */
export function toAdpCsv(records: PayrollRecord[], _startDate: string, _endDate: string): string {
  const header = row([
    'Co Code',
    'Batch ID',
    'File #',
    'Reg Hours',
    'O/T Hours',
    'Reg Earnings',
    'O/T Earnings',
    'Tips',
    'Commission',
    '3rd Party Sick Pay',
  ])

  const rows = records.map(r => row([
    '', // Co Code — venue fills in
    '', // Batch ID — venue fills in
    r.employeeId,
    r.regularHours,
    r.overtimeHours,
    r.grossRegularPay,
    r.grossOvertimePay,
    r.totalTipCompensation,
    r.commissionEarned,
    0,
  ]))

  return `${header}\n${rows.join('\n')}\n`
}

/**
 * Gusto-compatible CSV format.
 * Gusto bulk import: Employee ID, Employee Name, Regular Hours, OT Hours, Additional Earnings, Tips
 */
export function toGustoCsv(records: PayrollRecord[], _startDate: string, _endDate: string): string {
  const header = row([
    'Employee ID',
    'Employee Name',
    'Regular Hours',
    'Overtime Hours',
    'Additional Earnings',
    'Cash Tips',
    'Paycheck Tips',
    'Commission',
  ])

  const rows = records.map(r => row([
    r.employeeId,
    r.employeeName,
    r.regularHours,
    r.overtimeHours,
    0, // Additional Earnings
    r.cashTipsDeclared,
    r.cardTipsReceived,
    r.commissionEarned,
  ]))

  return `${header}\n${rows.join('\n')}\n`
}

/**
 * Paychex-compatible CSV format.
 * Paychex Flex import: Employee ID, Employee Name, Pay Type, Hours, Amount
 */
export function toPaychexCsv(records: PayrollRecord[], _startDate: string, _endDate: string): string {
  const header = row([
    'Employee ID',
    'Employee Name',
    'Pay Type',
    'Hours',
    'Amount',
  ])

  const rows: string[] = []
  for (const r of records) {
    if (r.regularHours > 0) {
      rows.push(row([r.employeeId, r.employeeName, 'Regular', r.regularHours, r.grossRegularPay]))
    }
    if (r.overtimeHours > 0) {
      rows.push(row([r.employeeId, r.employeeName, 'Overtime', r.overtimeHours, r.grossOvertimePay]))
    }
    if (r.totalTipCompensation > 0) {
      rows.push(row([r.employeeId, r.employeeName, 'Tips', 0, r.totalTipCompensation]))
    }
    if (r.commissionEarned > 0) {
      rows.push(row([r.employeeId, r.employeeName, 'Commission', 0, r.commissionEarned]))
    }
  }

  return `${header}\n${rows.join('\n')}\n`
}

/**
 * Format payroll records to the specified provider format.
 */
export function formatPayrollExport(
  records: PayrollRecord[],
  format: 'csv' | 'adp' | 'gusto' | 'paychex',
  startDate: string,
  endDate: string,
): string {
  switch (format) {
    case 'adp':
      return toAdpCsv(records, startDate, endDate)
    case 'gusto':
      return toGustoCsv(records, startDate, endDate)
    case 'paychex':
      return toPaychexCsv(records, startDate, endDate)
    case 'csv':
    default:
      return toGenericCsv(records, startDate, endDate)
  }
}
