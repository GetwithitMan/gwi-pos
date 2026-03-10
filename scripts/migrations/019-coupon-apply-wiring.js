/**
 * 019 — Coupon apply wiring
 *
 * Adds:
 * - Coupon.isStackable (default false)
 * - OrderDiscount.couponId (FK to Coupon)
 * - OrderDiscount.couponCode (denormalized for display)
 * - Index on OrderDiscount.couponId
 */

async function columnExists(prisma, table, column) {
  const result = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    table, column
  )
  return result.length > 0
}

module.exports.up = async function up(prisma) {
  // 1. Coupon.isStackable
  if (!(await columnExists(prisma, 'Coupon', 'isStackable'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Coupon" ADD COLUMN "isStackable" BOOLEAN NOT NULL DEFAULT false`
    )
    console.log('  + Coupon.isStackable')
  }

  // 2. OrderDiscount.couponId
  if (!(await columnExists(prisma, 'OrderDiscount', 'couponId'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OrderDiscount" ADD COLUMN "couponId" TEXT`
    )
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "OrderDiscount_couponId_idx" ON "OrderDiscount"("couponId")`
    )
    console.log('  + OrderDiscount.couponId + FK + index')
  }

  // 3. OrderDiscount.couponCode
  if (!(await columnExists(prisma, 'OrderDiscount', 'couponCode'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OrderDiscount" ADD COLUMN "couponCode" TEXT`
    )
    console.log('  + OrderDiscount.couponCode')
  }
}
