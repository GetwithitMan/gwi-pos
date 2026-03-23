/**
 * Migration 097 — Add pricing tier fields to Payment and convenience fee to Order
 *
 * Payment:
 *   - detectedCardType (TEXT, nullable) — 'credit' | 'debit' | null from Datacap CardLookup
 *   - appliedPricingTier (TEXT, NOT NULL, default 'cash') — which tier was applied
 *   - walletType (TEXT, nullable) — 'apple_pay' | 'google_pay' | 'samsung_pay' | null
 *   - pricingProgramSnapshot (JSONB, nullable) — pricing config snapshot at transaction time
 *
 * Order:
 *   - convenienceFee (DECIMAL(10,2), nullable) — per-channel convenience fee
 */
exports.up = async function up(prisma) {
  const PREFIX = '[097]'

  // Helper: check if a column exists
  async function columnExists(table, column) {
    const result = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      table, column
    )
    return result.length > 0
  }

  // Payment: detectedCardType
  if (!(await columnExists('Payment', 'detectedCardType'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "detectedCardType" TEXT`)
    console.log(`${PREFIX} Added Payment.detectedCardType`)
  }

  // Payment: appliedPricingTier (NOT NULL with default)
  if (!(await columnExists('Payment', 'appliedPricingTier'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "appliedPricingTier" TEXT NOT NULL DEFAULT 'cash'`)
    console.log(`${PREFIX} Added Payment.appliedPricingTier`)
  }

  // Payment: walletType
  if (!(await columnExists('Payment', 'walletType'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "walletType" TEXT`)
    console.log(`${PREFIX} Added Payment.walletType`)
  }

  // Payment: pricingProgramSnapshot
  if (!(await columnExists('Payment', 'pricingProgramSnapshot'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "pricingProgramSnapshot" JSONB`)
    console.log(`${PREFIX} Added Payment.pricingProgramSnapshot`)
  }

  // Order: convenienceFee
  if (!(await columnExists('Order', 'convenienceFee'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "convenienceFee" DECIMAL(10,2)`)
    console.log(`${PREFIX} Added Order.convenienceFee`)
  }

  // Backfill: correct appliedPricingTier for existing card/debit payments
  // New records get 'cash' default which is correct for cash payments.
  // Existing card payments were incorrectly set to 'cash' by the DEFAULT — fix them.
  // Idempotent: only updates rows where appliedPricingTier is still 'cash' and paymentMethod is card-based.
  const creditUpdated = await prisma.$executeRawUnsafe(
    `UPDATE "Payment" SET "appliedPricingTier" = 'credit' WHERE "paymentMethod" IN ('credit', 'card') AND "appliedPricingTier" = 'cash'`
  )
  if (creditUpdated > 0) console.log(`${PREFIX} Backfilled ${creditUpdated} credit/card payments → appliedPricingTier='credit'`)

  const debitUpdated = await prisma.$executeRawUnsafe(
    `UPDATE "Payment" SET "appliedPricingTier" = 'debit' WHERE "paymentMethod" = 'debit' AND "appliedPricingTier" IN ('cash', 'credit')`
  )
  if (debitUpdated > 0) console.log(`${PREFIX} Backfilled ${debitUpdated} debit payments → appliedPricingTier='debit'`)
}
