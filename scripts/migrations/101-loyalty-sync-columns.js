/**
 * Migration 101 — Add sync columns to Loyalty tables
 *
 * LoyaltyProgram + LoyaltyTier are bidirectional (MC creates, NUC consumes).
 * LoyaltyTransaction is upstream (NUC → Neon for reporting).
 *
 * All three need `syncedAt` for the sync worker watermark.
 * LoyaltyTransaction also needs `updatedAt` (it only had createdAt).
 */

const { columnExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[101]'

  // ── syncedAt for all 3 loyalty tables ──────────────────────────────────
  const tables = ['LoyaltyProgram', 'LoyaltyTier', 'LoyaltyTransaction']

  for (const table of tables) {
    if (!(await columnExists(prisma, table, 'syncedAt'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "syncedAt" TIMESTAMPTZ`)
      console.log(`${PREFIX} Added syncedAt to ${table}`)
    } else {
      console.log(`${PREFIX} ${table}.syncedAt already exists`)
    }
  }

  // ── updatedAt for LoyaltyTransaction (was missing — only had createdAt) ──
  if (!(await columnExists(prisma, 'LoyaltyTransaction', 'updatedAt'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "LoyaltyTransaction" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
    )
    console.log(`${PREFIX} Added updatedAt to LoyaltyTransaction`)
  } else {
    console.log(`${PREFIX} LoyaltyTransaction.updatedAt already exists`)
  }

  console.log(`${PREFIX} Done — loyalty sync columns added`)
}
