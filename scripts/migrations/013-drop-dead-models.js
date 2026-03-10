/**
 * Migration 013: Drop dead models
 *
 * Removes tables for Prisma models that have zero business-logic references:
 *   - UpsellEvent   (schema-only, no API/business code ever creates/reads)
 *   - UpsellConfig  (parent of UpsellEvent, also unreferenced)
 *   - PerformanceLog (monitoring route existed but was never called by any client)
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[013-drop-dead-models]'

  // Order matters: drop child tables before parents (FK constraints)
  const tablesToDrop = [
    'UpsellEvent',     // child of UpsellConfig
    'UpsellConfig',    // parent — drop after UpsellEvent
    'PerformanceLog',
  ]

  for (const table of tablesToDrop) {
    const exists = await tableExists(prisma, table)
    if (exists) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`)
      console.log(`${PREFIX}   Dropped table: ${table}`)
    } else {
      console.log(`${PREFIX}   Table ${table} does not exist — skipping`)
    }
  }
}

module.exports = { up }
