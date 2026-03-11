async function up(prisma) {
  // The order number query now resets per business day, so the old global
  // unique index (locationId, orderNumber) will reject valid duplicates
  // across different days. Replace it with a per-business-day scoped index
  // that uses the existing businessDayDate column.

  // Check if old index exists before dropping
  const oldIndex = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_indexes WHERE indexname = 'Order_locationId_orderNumber_unique'
  `)

  if (oldIndex.length > 0) {
    await prisma.$executeRawUnsafe(`
      DROP INDEX "Order_locationId_orderNumber_unique"
    `)
  }

  // Create new per-business-day unique index
  // Uses businessDayDate (already stamped on every order) for day-scoped uniqueness
  const newIndex = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM pg_indexes WHERE indexname = 'Order_locationId_orderNumber_businessDay_unique'
  `)

  if (newIndex.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "Order_locationId_orderNumber_businessDay_unique"
      ON "Order" ("locationId", "orderNumber", "businessDayDate")
      WHERE "parentOrderId" IS NULL AND "businessDayDate" IS NOT NULL
    `)
  }
}

module.exports = { up }
