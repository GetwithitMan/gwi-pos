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
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Order" SET "status" = 'voided' WHERE "status" = 'void'
  `)
  if (result > 0) {
    console.log(`[121] Updated ${result} orders from status 'void' to 'voided'`)
  } else {
    console.log('[121] No orders with status \'void\' found — nothing to update')
  }
}
