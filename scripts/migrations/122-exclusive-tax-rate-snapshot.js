/**
 * Migration 122: Add exclusive tax rate snapshot to Order
 *
 * The inclusive tax rate is already snapshotted on Order.inclusiveTaxRate.
 * This adds a parallel snapshot for the exclusive tax rate so that
 * recalculations on existing orders use the rate from order creation time,
 * not the current live rate (which may have changed mid-day).
 *
 * Nullable: null = not snapshotted (fallback to live rate), 0 = explicitly zero tax.
 * Idempotent: ADD COLUMN IF NOT EXISTS.
 */

module.exports.up = async function up(prisma) {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "exclusiveTaxRate" DECIMAL(10,4)
  `)
  console.log('[122] Added exclusiveTaxRate column to Order (nullable)')
}
