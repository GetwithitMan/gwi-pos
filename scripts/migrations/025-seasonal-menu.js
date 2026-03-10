/** Add seasonal date-based availability columns to MenuItem */
async function up(prisma) {
  // Check if columns already exist (idempotent)
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'MenuItem' AND column_name IN ('availableFromDate', 'availableUntilDate')
  `)
  const existing = new Set(cols.map(c => c.column_name))

  if (!existing.has('availableFromDate')) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MenuItem" ADD COLUMN "availableFromDate" TIMESTAMP
    `)
  }

  if (!existing.has('availableUntilDate')) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MenuItem" ADD COLUMN "availableUntilDate" TIMESTAMP
    `)
  }

  // Index for efficient seasonal filtering in menu queries
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "MenuItem_seasonal_dates_idx"
    ON "MenuItem" ("locationId", "availableFromDate", "availableUntilDate")
    WHERE "availableFromDate" IS NOT NULL OR "availableUntilDate" IS NOT NULL
  `)
}

module.exports = { up }
