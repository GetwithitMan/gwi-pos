async function up(prisma) {
  // Guard: check if table exists
  const exists = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'SocketEventLog') as exists
  `)
  if (exists[0]?.exists) return

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SocketEventLog" (
      id BIGSERIAL PRIMARY KEY,
      "locationId" TEXT NOT NULL,
      event TEXT NOT NULL,
      data JSONB NOT NULL,
      room TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_socket_event_log_location_id ON "SocketEventLog" ("locationId", id)
  `)
}

module.exports = { up }
