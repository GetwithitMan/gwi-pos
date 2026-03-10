/**
 * Migration 021: Order claim fields
 *
 * Adds claimedByEmployeeId, claimedByTerminalId, claimedAt to Order
 * for soft-lock concurrent editing prevention.
 * Adds compound index on (claimedByEmployeeId, claimedAt).
 */

const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[021-order-claim-fields]'

  // --- Order.claimedByEmployeeId ---
  try {
    const has = await columnExists(prisma, 'Order', 'claimedByEmployeeId')
    if (!has) {
      console.log(`${PREFIX}   Adding Order.claimedByEmployeeId...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "claimedByEmployeeId" TEXT`)
      console.log(`${PREFIX}   Done -- Order.claimedByEmployeeId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Order.claimedByEmployeeId:`, err.message)
  }

  // --- Order.claimedByTerminalId ---
  try {
    const has = await columnExists(prisma, 'Order', 'claimedByTerminalId')
    if (!has) {
      console.log(`${PREFIX}   Adding Order.claimedByTerminalId...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "claimedByTerminalId" TEXT`)
      console.log(`${PREFIX}   Done -- Order.claimedByTerminalId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Order.claimedByTerminalId:`, err.message)
  }

  // --- Order.claimedAt ---
  try {
    const has = await columnExists(prisma, 'Order', 'claimedAt')
    if (!has) {
      console.log(`${PREFIX}   Adding Order.claimedAt...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "claimedAt" TIMESTAMPTZ`)
      console.log(`${PREFIX}   Done -- Order.claimedAt added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Order.claimedAt:`, err.message)
  }

  // --- Compound index on (claimedByEmployeeId, claimedAt) ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_claimedByEmployeeId_claimedAt_idx"
      ON "Order" ("claimedByEmployeeId", "claimedAt")
    `).catch(() => {})
    console.log(`${PREFIX}   Index Order_claimedByEmployeeId_claimedAt_idx ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED index:`, err.message)
  }
}

module.exports = { up }
