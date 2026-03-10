/**
 * CSV Exporter for Daily Sales Journal
 *
 * Universal CSV format that can be imported into any accounting system.
 * Columns: Date, Account Code, Account Name, Debit, Credit, Memo
 */

import type { JournalEntry } from './daily-journal'

/**
 * Export journal entries to standard CSV format.
 * Works as a universal import format for QuickBooks, Xero, Sage, etc.
 */
export function exportToCSV(entries: JournalEntry[]): string {
  const header = 'Date,Account Code,Account Name,Debit,Credit,Memo'
  const rows = entries.map(e => {
    const date = e.date
    const code = csvEscape(e.accountCode)
    const name = csvEscape(e.accountName)
    const debit = e.debit > 0 ? e.debit.toFixed(2) : ''
    const credit = e.credit > 0 ? e.credit.toFixed(2) : ''
    const memo = csvEscape(e.memo)
    return `${date},${code},${name},${debit},${credit},${memo}`
  })

  return [header, ...rows].join('\n')
}

/**
 * Escape a CSV field — wrap in quotes if it contains commas, quotes, or newlines.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
