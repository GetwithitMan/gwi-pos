// Migration 027: Server Banking + Pre-Order / Scheduled Orders
// Adds scheduledFor column to Order for future order scheduling

async function columnExists(prisma, table, column) {
  const result = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
    LIMIT 1
  `, table, column)
  return result.length > 0
}

async function up(prisma) {
  // Add scheduledFor column to Order table for pre-orders / future orders
  if (!(await columnExists(prisma, 'Order', 'scheduledFor'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Order" ADD COLUMN "scheduledFor" TIMESTAMPTZ NULL
    `)
    console.log('  Added Order.scheduledFor column')
  }

  // Add index on scheduledFor for the cron job that fires scheduled orders
  const idxExists = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_indexes WHERE indexname = 'Order_scheduledFor_status_idx' LIMIT 1
  `)
  if (idxExists.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "Order_scheduledFor_status_idx"
      ON "Order" ("scheduledFor", "status")
      WHERE "scheduledFor" IS NOT NULL AND "deletedAt" IS NULL
    `)
    console.log('  Added Order_scheduledFor_status_idx index')
  }

  console.log('Migration 027 complete: Server Banking + Pre-Orders')
}

module.exports = { up }
