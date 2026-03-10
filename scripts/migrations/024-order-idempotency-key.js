/** Add idempotencyKey column to Order for creation-level dedup */
async function up(prisma) {
  // Check if column already exists (idempotent)
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'idempotencyKey'
  `)
  if (cols.length > 0) return

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT
  `)

  // Partial unique index — only non-null keys, scoped to location, excluding soft-deleted
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_locationId_key"
    ON "Order" ("idempotencyKey", "locationId")
    WHERE "idempotencyKey" IS NOT NULL AND "deletedAt" IS NULL
  `)
}

module.exports = { up }
