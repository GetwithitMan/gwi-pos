/**
 * Migration 041 — Add 'pending' to HouseAccountStatus enum
 *
 * New house accounts will default to 'pending' (requires card on file + SMS
 * verification before activation). Existing accounts are NOT changed — they
 * remain in their current status.
 */

async function up(prisma) {
  // Add the new enum value (idempotent — IF NOT EXISTS)
  await prisma.$executeRawUnsafe(`
    ALTER TYPE "HouseAccountStatus" ADD VALUE IF NOT EXISTS 'pending'
  `)

  // Update the column default so new rows start as pending
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "HouseAccount"
      ALTER COLUMN "status" SET DEFAULT 'pending'::"HouseAccountStatus"
  `)
}

module.exports = { up }
