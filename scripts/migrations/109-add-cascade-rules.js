/**
 * Migration 109 — Add cascade delete rules to Payment, OutageQueueEntry, SyncWatermark
 *
 * Fixes missing onDelete cascade rules that could cause orphaned records.
 * - Payment.orderId: Cascade (payments cascade with orders)
 * - OutageQueueEntry.locationId: Cascade (queue entries cascade with locations)
 * - SyncWatermark.locationId: Add FK + Cascade (was plain column, now proper FK)
 */

const { columnExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[109]'

  // Fix 1: Payment.orderId — drop existing FK, re-add with CASCADE
  try {
    // Find existing FK constraint name
    const fkResult = await prisma.$queryRawUnsafe(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'Payment' AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%orderId%'
    `)

    if (fkResult.length > 0) {
      const fkName = fkResult[0].constraint_name
      await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" DROP CONSTRAINT "${fkName}"`)
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Payment" ADD CONSTRAINT "${fkName}"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
      `)
      console.log(`${PREFIX} Fixed Payment.orderId cascade rule`)
    } else {
      console.log(`${PREFIX} Payment.orderId FK not found, skipping`)
    }
  } catch (err) {
    console.log(`${PREFIX} Payment.orderId cascade already set or error:`, err.message)
  }

  // Fix 2: OutageQueueEntry.locationId — drop existing FK, re-add with CASCADE
  try {
    const fkResult = await prisma.$queryRawUnsafe(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'OutageQueueEntry' AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%locationId%'
    `)

    if (fkResult.length > 0) {
      const fkName = fkResult[0].constraint_name
      await prisma.$executeRawUnsafe(`ALTER TABLE "OutageQueueEntry" DROP CONSTRAINT "${fkName}"`)
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "OutageQueueEntry" ADD CONSTRAINT "${fkName}"
        FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE
      `)
      console.log(`${PREFIX} Fixed OutageQueueEntry.locationId cascade rule`)
    } else {
      console.log(`${PREFIX} OutageQueueEntry.locationId FK not found, skipping`)
    }
  } catch (err) {
    console.log(`${PREFIX} OutageQueueEntry.locationId cascade already set or error:`, err.message)
  }

  // Fix 3: SyncWatermark.locationId — Add FK with CASCADE (was plain column)
  try {
    // Check if FK already exists
    const existing = await prisma.$queryRawUnsafe(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'SyncWatermark' AND constraint_type = 'FOREIGN KEY'
    `)

    if (existing.length === 0) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "SyncWatermark" ADD CONSTRAINT "SyncWatermark_locationId_fkey"
        FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE
      `)
      console.log(`${PREFIX} Added SyncWatermark.locationId FK with cascade`)
    } else {
      console.log(`${PREFIX} SyncWatermark.locationId FK already exists`)
    }
  } catch (err) {
    console.log(`${PREFIX} SyncWatermark FK error:`, err.message)
  }

  console.log(`${PREFIX} Migration 109 complete`)
}
