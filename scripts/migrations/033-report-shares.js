/**
 * Migration 033: Shared Report Links
 *
 * Creates:
 * - SharedReport — cached report snapshots with secure token-based sharing
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[033-report-shares]'

  // ─── SharedReport table ───────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'SharedReport'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "SharedReport" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"      TEXT NOT NULL,
        "token"           TEXT NOT NULL,
        "reportType"      TEXT NOT NULL,
        "parameters"      JSONB NOT NULL DEFAULT '{}',
        "generatedData"   JSONB NOT NULL DEFAULT '{}',
        "expiresAt"       TIMESTAMPTZ NOT NULL,
        "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "createdById"     TEXT,
        CONSTRAINT "SharedReport_pkey" PRIMARY KEY ("id")
      )
    `)
    console.log(`${PREFIX} Created SharedReport table`)
  } else {
    console.log(`${PREFIX} SharedReport already exists — skipping`)
  }

  // Unique index on token for fast public lookups
  if (!(await indexExists(prisma, 'SharedReport_token_key'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "SharedReport_token_key" ON "SharedReport" ("token")
    `)
    console.log(`${PREFIX} Created unique index on SharedReport.token`)
  }

  // Index on locationId for management queries
  if (!(await indexExists(prisma, 'SharedReport_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SharedReport_locationId_idx" ON "SharedReport" ("locationId")
    `)
    console.log(`${PREFIX} Created index on SharedReport.locationId`)
  }

  // Index on expiresAt for cleanup cron
  if (!(await indexExists(prisma, 'SharedReport_expiresAt_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SharedReport_expiresAt_idx" ON "SharedReport" ("expiresAt")
    `)
    console.log(`${PREFIX} Created index on SharedReport.expiresAt`)
  }

  console.log(`${PREFIX} Migration complete`)
}
