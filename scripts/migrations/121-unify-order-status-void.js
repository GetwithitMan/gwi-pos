/**
 * Migration 121: Unify Order Status 'void' → 'voided'
 *
 * Safety net: updates any orders that still have the legacy status string
 * 'void' to the canonical enum value 'voided'. The Prisma schema defines
 * OrderStatus.voided — 'void' is a stale value from before the enum was
 * standardised.
 *
 * Idempotent: safe to run multiple times (UPDATE ... WHERE is a no-op
 * when zero rows match).
 */

module.exports.up = async function up(prisma) {
  // The DB column uses a PostgreSQL enum — 'void' was never a valid enum value,
  // so no rows can exist with that status. Cast to text to avoid PG enum validation
  // error in the WHERE clause, making this a safe no-op.
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Order" SET "status" = 'voided' WHERE "status"::text = 'void'
  `)
  if (result > 0) {
    console.log(`[121] Updated ${result} orders from status 'void' to 'voided'`)
  } else {
    console.log('[121] No orders with status \'void\' found — nothing to update')
  }
}
