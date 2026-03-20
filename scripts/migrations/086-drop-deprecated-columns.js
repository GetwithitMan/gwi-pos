/**
 * Migration 086 — Drop deprecated columns
 *
 * Removes columns that were added by earlier migrations but later removed
 * from the Prisma schema (deprecated / no longer used):
 *   - syncVersion on Order, OrderItem, Payment, OrderDiscount, OrderCard, OrderItemModifier
 *   - nextCakeOrderNumber on Location
 *
 * This migration runs BEFORE prisma db push so the schema diff is clean
 * and --accept-data-loss is not needed.
 */

async function up(prisma) {
  const drops = [
    { table: 'Order', column: 'syncVersion' },
    { table: 'OrderItem', column: 'syncVersion' },
    { table: 'Payment', column: 'syncVersion' },
    { table: 'OrderDiscount', column: 'syncVersion' },
    { table: 'OrderCard', column: 'syncVersion' },
    { table: 'OrderItemModifier', column: 'syncVersion' },
    { table: 'Location', column: 'nextCakeOrderNumber' },
  ]

  for (const { table, column } of drops) {
    const [{ exists }] = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${table}'
          AND column_name = '${column}'
      ) AS exists
    `)
    if (exists) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "${column}"`)
      console.log(`[086] Dropped ${table}.${column}`)
    } else {
      console.log(`[086] ${table}.${column} already gone — skipping`)
    }
  }
}

module.exports = { up }
