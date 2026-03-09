/**
 * Migration 017: Add 'cancelled' to DeductionStatus enum
 *
 * Supports Fix C8 (void-before-deduction race): when an order is voided before
 * its PendingDeduction has run, the deduction is cancelled instead of restored.
 */

async function up(prisma) {
  // Add 'cancelled' to the DeductionStatus enum if it doesn't already exist
  const existing = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'cancelled'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeductionStatus')
  `)
  if (existing.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "DeductionStatus" ADD VALUE IF NOT EXISTS 'cancelled'`)
  }
}

module.exports = { up }
