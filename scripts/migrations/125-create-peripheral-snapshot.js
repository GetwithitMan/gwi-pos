/**
 * Migration 125: Create PeripheralSnapshot table
 *
 * Stores device health snapshots (terminals, printers, readers, scales, KDS)
 * for MC fleet visibility and local NUC dashboard PeripheralsCard.
 */
async function up(prisma) {
  // Guard: skip if table already exists
  const exists = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'PeripheralSnapshot' LIMIT 1
  `)
  if (exists.length > 0) {
    console.log('[migration-125] PeripheralSnapshot table already exists, skipping')
    return
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "PeripheralSnapshot" (
      "id" TEXT NOT NULL,
      "locationId" TEXT NOT NULL,
      "deviceType" TEXT NOT NULL,
      "deviceId" TEXT NOT NULL,
      "deviceName" TEXT NOT NULL,
      "isOnline" BOOLEAN NOT NULL DEFAULT false,
      "lastSeenAt" TIMESTAMPTZ,
      "lastError" TEXT,
      "metadata" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "deletedAt" TIMESTAMPTZ,
      "lastMutatedBy" TEXT,
      "syncedAt" TIMESTAMPTZ,
      CONSTRAINT "PeripheralSnapshot_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "PeripheralSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "PeripheralSnapshot_locationId_deviceType_deviceId_key"
    ON "PeripheralSnapshot"("locationId", "deviceType", "deviceId")
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "PeripheralSnapshot_locationId_idx" ON "PeripheralSnapshot"("locationId")
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "PeripheralSnapshot_locationId_updatedAt_idx" ON "PeripheralSnapshot"("locationId", "updatedAt")
  `)

  console.log('[migration-125] Created PeripheralSnapshot table with indexes')
}

module.exports = { up }
