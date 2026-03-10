/**
 * Xero CSV Exporter for Daily Sales Journal
 *
 * Xero's Manual Journal import format uses CSV with specific columns:
 *   *Date, *Description, *AccountCode, *Debit, *Credit
 *
 * Columns prefixed with * are required.
 * Date format: DD/MM/YYYY (Xero default) or YYYY-MM-DD (ISO)
 *
 * Reference: https://central.xero.com/s/article/Import-a-manual-journal
 */

import type { JournalEntry } from './daily-journal'

/**
 * Export journal entries to Xero manual journal CSV format.
 *
 * @param entries - Journal entries to export
 * @returns CSV string in Xero's expected format
 */
export function exportToXeroCSV(entries: JournalEntry[]): string {
  // Xero requires these exact column headers
  const header = '*Date,*Description,*AccountCode,*Debit,*Credit'

  const rows = entries.map(e => {
    // Xero accepts YYYY-MM-DD
    const date = e.date
    const description = xeroEscape(e.memo)
    const accountCode = xeroEscape(e.accountCode)
    const debit = e.debit > 0 ? e.debit.toFixed(2) : ''
    const credit = e.credit > 0 ? e.credit.toFixed(2) : ''

    return `${date},${description},${accountCode},${debit},${credit}`
  })

  return [header, ...rows].join('\n')
}

/**
 * Escape a value for Xero CSV — wrap in quotes if it contains special characters.
 */
function xeroEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
