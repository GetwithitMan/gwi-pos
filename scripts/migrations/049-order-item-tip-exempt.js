/**
 * Migration 049: Add tipExempt column to OrderItem
 *
 * Snapshots the MenuItem.tipExempt flag at order time so that
 * tip suggestion calculations can exclude exempt items from the basis.
 */

const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[049-order-item-tip-exempt]'

  const exists = await columnExists(prisma, 'OrderItem', 'tipExempt')
  if (exists) {
    console.log(`${PREFIX}   tipExempt column already exists on OrderItem -- skipping`)
    return
  }

  console.log(`${PREFIX}   Adding tipExempt column to OrderItem...`)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "OrderItem" ADD COLUMN "tipExempt" BOOLEAN NOT NULL DEFAULT false`
  )
  console.log(`${PREFIX}   Done.`)
}

module.exports = { up }
