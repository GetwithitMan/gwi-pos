/**
 * Migration 003: updatedAt backfills
 *
 * Adds updatedAt column to tables that need it for Prisma @updatedAt.
 * Backfills with NOW() and sets NOT NULL so prisma db push sees them as matching.
 */

const { columnExists, tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[003-updatedAt-backfills]'

  const updatedAtTables = [
    'OrderOwnershipEntry', 'PaymentReaderLog', 'TipLedgerEntry',
    'TipTransaction', 'cloud_event_queue',
  ]

  for (const table of updatedAtTables) {
    try {
      const tblExists = await tableExists(prisma, table)
      if (!tblExists) {
        console.log(`${PREFIX}   ${table} not found -- skipping`)
        continue
      }
      const exists = await columnExists(prisma, table, 'updatedAt')
      if (!exists) {
        console.log(`${PREFIX}   Adding updatedAt to ${table}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "updatedAt" TIMESTAMPTZ`)
      }
      await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "updatedAt" SET NOT NULL`)
      if (!exists) console.log(`${PREFIX}   Done -- ${table}.updatedAt backfilled`)
    } catch (err) {
      console.error(`${PREFIX}   FAILED ${table}.updatedAt:`, err.message)
    }
  }
}

module.exports = { up }
