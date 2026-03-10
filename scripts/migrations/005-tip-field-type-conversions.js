/**
 * Migration 005: Int -> Decimal(10,2) conversions for tip fields
 *
 * Converts integer tip-related columns to Decimal(10,2) to avoid
 * data truncation issues when Prisma db push handles type changes.
 */

const { tableExists } = require('../migration-helpers')

async function isIntegerColumn(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table, column
  )
  return rows.length > 0 && rows[0].data_type === 'integer'
}

async function up(prisma) {
  const PREFIX = '[005-tip-field-type-conversions]'

  const decimalConversions = [
    ['TipLedger', 'currentBalanceCents'],
    ['TipLedgerEntry', 'amountCents'],
    ['TipTransaction', 'amountCents'],
    ['TipTransaction', 'ccFeeAmountCents'],
    ['TipDebt', 'originalAmountCents'],
    ['TipDebt', 'remainingCents'],
    ['CashTipDeclaration', 'amountCents'],
  ]

  for (const [table, column] of decimalConversions) {
    try {
      const tblExists = await tableExists(prisma, table)
      if (!tblExists) continue
      if (await isIntegerColumn(prisma, table, column)) {
        console.log(`${PREFIX}   Converting ${table}.${column} INT -> DECIMAL(10,2)...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE DECIMAL(10,2)`)
        console.log(`${PREFIX}   Done`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ${table}.${column}:`, err.message)
    }
  }
}

module.exports = { up }
