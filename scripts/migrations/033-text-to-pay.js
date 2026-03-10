/**
 * Migration 033: Text-to-Pay (Payment Links)
 *
 * Creates:
 * - PaymentLink — secure tokenized payment links sent via SMS/email
 *   for remote card-not-present payment (Datacap keyedSale)
 */

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = $1
    LIMIT 1
  `, table)
  return rows.length > 0
}

module.exports.up = async function up(prisma) {
  if (!(await tableExists(prisma, 'PaymentLink'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "PaymentLink" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"      TEXT NOT NULL,
        "orderId"         TEXT NOT NULL,
        "token"           TEXT NOT NULL,
        "amount"          DECIMAL(10,2) NOT NULL,
        "tipAmount"       DECIMAL(10,2) NOT NULL DEFAULT 0,
        "status"          TEXT NOT NULL DEFAULT 'pending',
        "expiresAt"       TIMESTAMP(3) NOT NULL,
        "phoneNumber"     TEXT,
        "email"           TEXT,
        "completedAt"     TIMESTAMP(3),
        "paymentId"       TEXT,
        "createdByEmployeeId" TEXT,
        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"       TIMESTAMP(3),
        "syncedAt"        TIMESTAMP(3),

        CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PaymentLink_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "PaymentLink_orderId_fkey"
          FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT
      )
    `)

    // Unique token index (lookup by token must be fast)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "PaymentLink_token_key" ON "PaymentLink" ("token")
    `)

    // Query indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentLink_locationId_idx" ON "PaymentLink" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentLink_orderId_idx" ON "PaymentLink" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentLink_status_idx" ON "PaymentLink" ("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "PaymentLink_expiresAt_idx" ON "PaymentLink" ("expiresAt")`)

    console.log('[033] Created PaymentLink table')
  }
}
