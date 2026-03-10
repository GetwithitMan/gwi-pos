const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[028-waitlist-menu-snapshots]'

  // ─── WaitlistEntry table ──────────────────────────────────────────────────
  const waitlistExists = await tableExists(prisma, 'WaitlistEntry')
  if (!waitlistExists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "WaitlistEntry" (
        "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"   TEXT NOT NULL,
        "customerName" TEXT NOT NULL,
        "partySize"    INTEGER NOT NULL DEFAULT 1,
        "phone"        TEXT,
        "notes"        TEXT,
        "status"       TEXT NOT NULL DEFAULT 'waiting',
        "position"     INTEGER NOT NULL DEFAULT 0,
        "quotedWaitMinutes" INTEGER,
        "notifiedAt"   TIMESTAMP(3),
        "seatedAt"     TIMESTAMP(3),
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "WaitlistEntry_locationId_status_idx" ON "WaitlistEntry" ("locationId", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "WaitlistEntry_locationId_position_idx" ON "WaitlistEntry" ("locationId", "position")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "WaitlistEntry_phone_idx" ON "WaitlistEntry" ("phone")`)
    console.log(`${PREFIX} Created WaitlistEntry table + indexes`)
  } else {
    console.log(`${PREFIX} WaitlistEntry table already exists — skipping`)
  }

  // ─── MenuSnapshot table ───────────────────────────────────────────────────
  const snapshotExists = await tableExists(prisma, 'MenuSnapshot')
  if (!snapshotExists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "MenuSnapshot" (
        "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"    TEXT NOT NULL,
        "label"         TEXT,
        "createdById"   TEXT,
        "createdByName" TEXT,
        "itemCount"     INTEGER NOT NULL DEFAULT 0,
        "categoryCount" INTEGER NOT NULL DEFAULT 0,
        "data"          JSONB NOT NULL DEFAULT '{}'::jsonb,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MenuSnapshot_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "MenuSnapshot_locationId_idx" ON "MenuSnapshot" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "MenuSnapshot_createdAt_idx" ON "MenuSnapshot" ("locationId", "createdAt" DESC)`)
    console.log(`${PREFIX} Created MenuSnapshot table + indexes`)
  } else {
    console.log(`${PREFIX} MenuSnapshot table already exists — skipping`)
  }
}

module.exports = { up }
