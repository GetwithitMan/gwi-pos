/**
 * QuickBooks IIF Exporter for Daily Sales Journal
 *
 * IIF (Intuit Interchange Format) is a tab-delimited text format for importing
 * transactions into QuickBooks Desktop. Structure:
 *   !TRNS — transaction header definition
 *   !SPL  — split line definition
 *   !ENDTRNS — end marker
 *   TRNS — first line of each transaction (date, account, amount, memo)
 *   SPL  — subsequent split lines (one per journal entry line)
 *   ENDTRNS — end of transaction
 *
 * Reference: https://quickbooks.intuit.com/learn-support/en-us/import-data/
 */

import type { JournalEntry } from './daily-journal'

const TAB = '\t'

/**
 * Export journal entries to QuickBooks IIF format.
 *
 * @param entries - Journal entries to export
 * @param companyName - Company name for the IIF header
 * @returns IIF formatted string ready for import
 */
export function exportToIIF(entries: JournalEntry[], companyName: string): string {
  if (entries.length === 0) return ''

  const lines: string[] = []

  // ── Header Definitions ──────────────────────────────────────────────
  // Define the column structure for TRNS (transaction) and SPL (split) rows
  lines.push(
    ['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join(TAB)
  )
  lines.push(
    ['!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join(TAB)
  )
  lines.push('!ENDTRNS')

  // ── Transaction Body ────────────────────────────────────────────────
  // In IIF format, each journal entry is a transaction with one TRNS line
  // and one or more SPL lines. The TRNS line carries the first debit/credit,
  // and SPL lines carry the rest.
  //
  // For a daily journal, we group everything into a single GENERAL JOURNAL transaction.

  if (entries.length === 0) return lines.join('\n')

  const date = entries[0].date
  // Format date as MM/DD/YYYY for QuickBooks
  const [year, month, day] = date.split('-')
  const iifDate = `${month}/${day}/${year}`

  // First entry is the TRNS line
  const first = entries[0]
  const firstAmount = first.debit > 0 ? first.debit : -first.credit

  lines.push([
    'TRNS',
    '',                                    // TRNSID (auto-assigned)
    'GENERAL JOURNAL',                     // TRNSTYPE
    iifDate,                               // DATE
    iifAccountName(first),                 // ACCNT
    companyName,                           // NAME
    '',                                    // CLASS
    firstAmount.toFixed(2),                // AMOUNT (positive = debit, negative = credit)
    `DJ-${date}`,                          // DOCNUM (document number)
    first.memo,                            // MEMO
  ].join(TAB))

  // Remaining entries are SPL lines
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]
    const amount = entry.debit > 0 ? entry.debit : -entry.credit

    lines.push([
      'SPL',
      '',                                  // SPLID (auto-assigned)
      'GENERAL JOURNAL',                   // TRNSTYPE
      iifDate,                             // DATE
      iifAccountName(entry),               // ACCNT
      '',                                  // NAME
      '',                                  // CLASS
      amount.toFixed(2),                   // AMOUNT
      '',                                  // DOCNUM
      entry.memo,                          // MEMO
    ].join(TAB))
  }

  lines.push('ENDTRNS')

  return lines.join('\n')
}

/**
 * Build the IIF account name from the journal entry.
 * QuickBooks uses account names (not codes) in IIF format.
 * Format: "Code - Name" so users can match by code or name.
 */
function iifAccountName(entry: JournalEntry): string {
  return `${entry.accountCode} - ${entry.accountName}`
}
