const { tableExists, columnExists } = require('../migration-helpers')

async function up(prisma) {
  const exists = await tableExists(prisma, 'VenueLog')
  if (exists) return

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "VenueLog" (
      "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "locationId"  TEXT NOT NULL,
      "level"       TEXT NOT NULL DEFAULT 'info',
      "source"      TEXT NOT NULL DEFAULT 'server',
      "category"    TEXT NOT NULL DEFAULT 'system',
      "message"     TEXT NOT NULL,
      "details"     JSONB,
      "employeeId"  TEXT,
      "deviceId"    TEXT,
      "stackTrace"  TEXT,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt"   TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),

      CONSTRAINT "VenueLog_pkey" PRIMARY KEY ("id")
    );
  `)

  // Indices for common query patterns
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VenueLog_locationId_createdAt_idx"
      ON "VenueLog" ("locationId", "createdAt" DESC);
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VenueLog_level_idx"
      ON "VenueLog" ("level");
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VenueLog_source_idx"
      ON "VenueLog" ("source");
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VenueLog_category_idx"
      ON "VenueLog" ("category");
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VenueLog_expiresAt_idx"
      ON "VenueLog" ("expiresAt");
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VenueLog_createdAt_idx"
      ON "VenueLog" ("createdAt" DESC);
  `)
}

module.exports = { up }
