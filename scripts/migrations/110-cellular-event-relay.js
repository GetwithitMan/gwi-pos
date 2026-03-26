/**
 * 110 — CellularEvent relay table
 * Stores socket events for SSE delivery to cellular terminals.
 */
async function up(prisma) {
  const tableExists = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CellularEvent')
  `)
  if (tableExists[0]?.exists) return

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "CellularEvent" (
      "id" BIGSERIAL PRIMARY KEY,
      "locationId" TEXT NOT NULL,
      "event" TEXT NOT NULL,
      "data" JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX "idx_cellular_event_location_id" ON "CellularEvent" ("locationId", "id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX "idx_cellular_event_cleanup" ON "CellularEvent" ("createdAt")`)
}

module.exports = { up }
