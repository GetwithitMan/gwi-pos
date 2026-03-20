/**
 * Migration 087 — Add metadata JSONB to ReservationDeposit
 *
 * Adds a nullable metadata column for storing idempotency keys
 * and other deposit-related metadata.
 */

async function up(prisma) {
  const [{ exists }] = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ReservationDeposit'
        AND column_name = 'metadata'
    ) as exists
  `)

  if (!exists) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ReservationDeposit" ADD COLUMN "metadata" JSONB
    `)
  }
}

module.exports = { up }
