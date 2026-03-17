/**
 * Migration 068 — Add 'optional_unpaid' to Reservation.depositStatus CHECK constraint
 *
 * Supports the new "optional" deposit mode where deposits are offered but not required.
 */

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-068]'

  // Drop existing constraint and re-create with the new value
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_depositStatus_check"`)
    console.log(`${PREFIX} Dropped existing Reservation_depositStatus_check`)
  } catch {
    console.log(`${PREFIX} No existing Reservation_depositStatus_check to drop`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_depositStatus_check"
      CHECK ("depositStatus" IS NULL OR "depositStatus" IN ('not_required', 'optional_unpaid', 'required', 'required_unpaid', 'hold_pending', 'paid', 'refund_pending', 'refunded', 'partial_refund', 'forfeited', 'pending'))
    `)
    console.log(`${PREFIX} Added updated Reservation_depositStatus_check with 'optional_unpaid'`)
  } catch (err) {
    console.log(`${PREFIX} Failed to add Reservation_depositStatus_check:`, err.message)
  }

  console.log(`${PREFIX} Migration 068 complete`)
}
