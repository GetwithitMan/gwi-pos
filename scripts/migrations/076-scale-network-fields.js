/**
 * Migration 076: Add network connection fields to Scale model.
 * Allows scales to connect via serial device server (TCP) instead of only USB-serial.
 */
async function up(prisma) {
  // Add connectionType with default 'serial' for existing rows
  const hasConnectionType = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Scale' AND column_name = 'connectionType' LIMIT 1
  `
  if (hasConnectionType.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Scale" ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'serial'`)
  }

  // Add networkHost
  const hasNetworkHost = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Scale' AND column_name = 'networkHost' LIMIT 1
  `
  if (hasNetworkHost.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Scale" ADD COLUMN "networkHost" TEXT`)
  }

  // Add networkPort
  const hasNetworkPort = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Scale' AND column_name = 'networkPort' LIMIT 1
  `
  if (hasNetworkPort.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Scale" ADD COLUMN "networkPort" INTEGER`)
  }

  // Make portPath nullable (network scales don't need a serial port path)
  await prisma.$executeRawUnsafe(`ALTER TABLE "Scale" ALTER COLUMN "portPath" DROP NOT NULL`)

  // Drop the unique constraint on (locationId, portPath) if it exists
  // Network scales have no portPath, so this constraint doesn't make sense
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Scale" DROP CONSTRAINT IF EXISTS "Scale_locationId_portPath_key"`)
  } catch (_) {
    // Constraint may not exist
  }
}

module.exports = { up }
