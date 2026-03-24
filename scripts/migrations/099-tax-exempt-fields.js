/**
 * Migration 098 — Add tax exemption detail fields to Order
 *
 * Order:
 *   - taxExemptReason (TEXT, nullable) — why order is tax exempt
 *   - taxExemptId (TEXT, nullable) — customer's tax ID for B2B
 *   - taxExemptApprovedBy (TEXT, nullable) — employee ID who approved
 *   - taxExemptSavedAmount (DECIMAL(10,2), nullable) — pre-exempt tax amount for audit
 */
exports.up = async function up(prisma) {
  const PREFIX = '[098]'

  // Helper: check if a column exists
  async function columnExists(table, column) {
    const result = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      table, column
    )
    return result.length > 0
  }

  // Order: taxExemptReason
  if (!(await columnExists('Order', 'taxExemptReason'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "taxExemptReason" TEXT`)
    console.log(`${PREFIX} Added Order.taxExemptReason`)
  }

  // Order: taxExemptId
  if (!(await columnExists('Order', 'taxExemptId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "taxExemptId" TEXT`)
    console.log(`${PREFIX} Added Order.taxExemptId`)
  }

  // Order: taxExemptApprovedBy
  if (!(await columnExists('Order', 'taxExemptApprovedBy'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "taxExemptApprovedBy" TEXT`)
    console.log(`${PREFIX} Added Order.taxExemptApprovedBy`)
  }

  // Order: taxExemptSavedAmount (stores the tax that would have been charged)
  if (!(await columnExists('Order', 'taxExemptSavedAmount'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "taxExemptSavedAmount" DECIMAL(10,2)`)
    console.log(`${PREFIX} Added Order.taxExemptSavedAmount`)
  }
}
