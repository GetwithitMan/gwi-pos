const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[029-customer-feedback-pour-control]'

  // ─── CustomerFeedback table ─────────────────────────────────────────────────
  const feedbackExists = await tableExists(prisma, 'CustomerFeedback')
  if (!feedbackExists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CustomerFeedback" (
        "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"  TEXT NOT NULL,
        "orderId"     TEXT,
        "customerId"  TEXT,
        "employeeId"  TEXT,
        "rating"      INTEGER NOT NULL,
        "comment"     TEXT,
        "source"      TEXT NOT NULL DEFAULT 'in_store',
        "tags"        TEXT[] DEFAULT '{}',
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"   TIMESTAMP(3),
        CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CustomerFeedback_locationId_createdAt_idx" ON "CustomerFeedback" ("locationId", "createdAt" DESC)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CustomerFeedback_locationId_rating_idx" ON "CustomerFeedback" ("locationId", "rating")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CustomerFeedback_orderId_idx" ON "CustomerFeedback" ("orderId")`)
    console.log(`${PREFIX} Created CustomerFeedback table + indexes`)
  } else {
    console.log(`${PREFIX} CustomerFeedback table already exists — skipping`)
  }

  // ─── PourLog table ──────────────────────────────────────────────────────────
  const pourLogExists = await tableExists(prisma, 'PourLog')
  if (!pourLogExists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "PourLog" (
        "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"  TEXT NOT NULL,
        "menuItemId"  TEXT,
        "employeeId"  TEXT,
        "targetOz"    DOUBLE PRECISION NOT NULL,
        "actualOz"    DOUBLE PRECISION NOT NULL,
        "varianceOz"  DOUBLE PRECISION NOT NULL DEFAULT 0,
        "isOverPour"  BOOLEAN NOT NULL DEFAULT false,
        "wasteCost"   DOUBLE PRECISION NOT NULL DEFAULT 0,
        "tapId"       TEXT,
        "source"      TEXT NOT NULL DEFAULT 'manual',
        "pouredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PourLog_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "PourLog_locationId_pouredAt_idx" ON "PourLog" ("locationId", "pouredAt" DESC)`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "PourLog_locationId_employeeId_idx" ON "PourLog" ("locationId", "employeeId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "PourLog_locationId_isOverPour_idx" ON "PourLog" ("locationId", "isOverPour") WHERE "isOverPour" = true`)
    console.log(`${PREFIX} Created PourLog table + indexes`)
  } else {
    console.log(`${PREFIX} PourLog table already exists — skipping`)
  }
}

module.exports = { up }
