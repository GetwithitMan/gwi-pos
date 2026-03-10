/**
 * Migration 004: Order deduplication + partial unique index
 *
 * Deduplicates root orders with colliding (locationId, orderNumber),
 * drops any plain unique index, and creates a partial unique index
 * that only covers root orders (parentOrderId IS NULL).
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[004-order-partial-unique-index]'

  try {
    const orderExists = await tableExists(prisma, 'Order')
    if (!orderExists) {
      console.log(`${PREFIX}   Order table not found -- skipping`)
      return
    }

    const dupes = await prisma.$queryRawUnsafe(`
      SELECT "locationId", "orderNumber", COUNT(*) as cnt
      FROM "Order" WHERE "parentOrderId" IS NULL
      GROUP BY "locationId", "orderNumber" HAVING COUNT(*) > 1
    `)
    if (dupes.length > 0) {
      console.log(`${PREFIX}   Deduplicating ${dupes.length} duplicate orderNumber groups...`)
      const [maxRow] = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX("orderNumber"), 0) as mx FROM "Order"`)
      let nextNum = Math.max(Number(maxRow.mx), 900000) + 1000
      for (const { locationId, orderNumber } of dupes) {
        const orders = await prisma.$queryRawUnsafe(`
          SELECT id FROM "Order"
          WHERE "locationId" = $1 AND "orderNumber" = $2 AND "parentOrderId" IS NULL
          ORDER BY "createdAt" DESC
        `, locationId, Number(orderNumber))
        for (let i = 1; i < orders.length; i++) {
          nextNum++
          await prisma.$executeRawUnsafe(`UPDATE "Order" SET "orderNumber" = $1 WHERE id = $2`, nextNum, orders[i].id)
        }
      }
      console.log(`${PREFIX}   Done -- duplicate orderNumbers resolved`)
    }

    const [plainIdx] = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'Order' AND indexname = 'Order_locationId_orderNumber_key'`)
    if (plainIdx) {
      console.log(`${PREFIX}   Dropping plain unique index...`)
      await prisma.$executeRawUnsafe(`DROP INDEX "Order_locationId_orderNumber_key"`)
    }
    const [partialIdx] = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'Order' AND indexname = 'Order_locationId_orderNumber_unique'`)
    if (!partialIdx) {
      console.log(`${PREFIX}   Creating partial unique index...`)
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Order_locationId_orderNumber_unique" ON "Order" ("locationId", "orderNumber") WHERE "parentOrderId" IS NULL`)
      console.log(`${PREFIX}   Done`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED order dedup/index:`, err.message)
  }
}

module.exports = { up }
