/**
 * Migration 047: Add tipExempt column to MenuItem
 *
 * Marks items as excluded from tip calculation basis.
 * When tipExempt is true, the item's amount is not included
 * in the subtotal used for tip percentage suggestions.
 */

const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[047-tip-exempt-items]'

  const exists = await columnExists(prisma, 'MenuItem', 'tipExempt')
  if (exists) {
    console.log(`${PREFIX}   tipExempt column already exists -- skipping`)
    return
  }

  console.log(`${PREFIX}   Adding tipExempt column to MenuItem...`)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "MenuItem" ADD COLUMN "tipExempt" BOOLEAN NOT NULL DEFAULT false`
  )
  console.log(`${PREFIX}   Done.`)
}

module.exports = { up }
