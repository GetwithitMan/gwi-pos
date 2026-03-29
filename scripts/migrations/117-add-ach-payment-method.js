/**
 * Migration 117: Add 'ach' to PaymentMethod enum
 *
 * Adds ACH (bank account) as a payment method for online ordering via Datacap PayAPI.
 * The 'ach' enum value allows Payment records to distinguish ACH transactions
 * from credit card, debit, cash, etc.
 *
 * ACH payments settle in 2-3 business days (unlike instant card auth).
 * Required fields for ACH refund/void are stored in the existing Payment columns:
 *   - datacapRefNumber: Datacap RefNo for return/void operations
 *   - cardBrand: stores "Checking" or "Savings" (account type)
 *   - cardLast4: last 4 digits of bank account number
 *   - entryMethod: "ACH"
 */

async function enumValueExists(prisma, enumName, value) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = $1 AND pg_enum.enumlabel = $2
    LIMIT 1
  `, enumName, value)
  return rows.length > 0
}

async function up(prisma) {
  // Add 'ach' to PaymentMethod enum if not already present
  const achExists = await enumValueExists(prisma, 'PaymentMethod', 'ach')
  if (!achExists) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ach'`)
    console.log('  + Added "ach" to PaymentMethod enum')
  } else {
    console.log('  ~ "ach" already exists in PaymentMethod enum — skipped')
  }
}

module.exports = { up }
