/**
 * Migration 021: Print retry queue + KDS speed-of-service tracking
 *
 * 1. Add 'queued' and 'failed_permanent' to PrintJobStatus enum
 * 2. Add kitchenSentAt to OrderItem (speed-of-service: sentAt → completedAt)
 * 3. Add kitchenSentAt to OrderItemSnapshot
 */

async function columnExists(prisma, table, column) {
  const result = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    table, column
  )
  return result.length > 0
}

async function enumValueExists(prisma, enumName, value) {
  const result = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum WHERE enumlabel = $1 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = $2) LIMIT 1`,
    value, enumName
  )
  return result.length > 0
}

module.exports.up = async function up(prisma) {
  // 1. Add 'queued' to PrintJobStatus enum
  if (!(await enumValueExists(prisma, 'PrintJobStatus', 'queued'))) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "PrintJobStatus" ADD VALUE IF NOT EXISTS 'queued' AFTER 'pending'`)
  }

  // 2. Add 'failed_permanent' to PrintJobStatus enum
  if (!(await enumValueExists(prisma, 'PrintJobStatus', 'failed_permanent'))) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "PrintJobStatus" ADD VALUE IF NOT EXISTS 'failed_permanent' AFTER 'failed'`)
  }

  // 3. Add kitchenSentAt to OrderItem
  if (!(await columnExists(prisma, 'OrderItem', 'kitchenSentAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OrderItem" ADD COLUMN "kitchenSentAt" TIMESTAMPTZ`)
  }

  // 4. Add kitchenSentAt to OrderItemSnapshot
  if (!(await columnExists(prisma, 'OrderItemSnapshot', 'kitchenSentAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OrderItemSnapshot" ADD COLUMN "kitchenSentAt" TIMESTAMPTZ`)
  }

  // 5. Backfill kitchenSentAt from Order.sentAt for existing items that were already sent
  // This gives us historical speed-of-service data
  await prisma.$executeRawUnsafe(`
    UPDATE "OrderItem" oi
    SET "kitchenSentAt" = o."sentAt"
    FROM "Order" o
    WHERE oi."orderId" = o.id
      AND oi."kitchenSentAt" IS NULL
      AND oi."kitchenStatus" != 'pending'
      AND o."sentAt" IS NOT NULL
  `)
}
