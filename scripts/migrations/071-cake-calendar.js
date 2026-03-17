/**
 * Migration 071 — Cake Calendar Blocks
 *
 * Creates: CakeCalendarBlock (production/decoration/delivery scheduling)
 * Adds: CHECK constraint on blockType, indexes for calendar queries
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-071]'

  // ─── 1. CakeCalendarBlock table ────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CakeCalendarBlock'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CakeCalendarBlock" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL REFERENCES "Location"("id"),
        "cakeOrderId" TEXT REFERENCES "CakeOrder"("id"),
        "title" TEXT NOT NULL,
        "startDate" DATE NOT NULL,
        "endDate" DATE NOT NULL,
        "blockType" TEXT NOT NULL DEFAULT 'production',
        "employeeId" TEXT REFERENCES "Employee"("id"),
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created CakeCalendarBlock table`)
  } else {
    console.log(`${PREFIX} CakeCalendarBlock table already exists`)
  }

  // ─── 2. CHECK constraint — blockType ────────────────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeCalendarBlock" ADD CONSTRAINT "CakeCalendarBlock_blockType_check"
      CHECK ("blockType" IN ('production','decoration','delivery','blocked'))
    `)
    console.log(`${PREFIX} Added CakeCalendarBlock_blockType_check`)
  } catch {
    console.log(`${PREFIX} CakeCalendarBlock_blockType_check already exists`)
  }

  // ─── 3. Indexes ─────────────────────────────────────────────────────────────
  if (!(await indexExists(prisma, 'CakeCalendarBlock_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeCalendarBlock_locationId_idx" ON "CakeCalendarBlock" ("locationId")`)
    console.log(`${PREFIX} Created CakeCalendarBlock_locationId_idx`)
  }

  if (!(await indexExists(prisma, 'CakeCalendarBlock_cakeOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeCalendarBlock_cakeOrderId_idx" ON "CakeCalendarBlock" ("cakeOrderId") WHERE "cakeOrderId" IS NOT NULL`)
    console.log(`${PREFIX} Created CakeCalendarBlock_cakeOrderId_idx`)
  }

  if (!(await indexExists(prisma, 'CakeCalendarBlock_startDate_endDate_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeCalendarBlock_startDate_endDate_idx" ON "CakeCalendarBlock" ("startDate", "endDate")`)
    console.log(`${PREFIX} Created CakeCalendarBlock_startDate_endDate_idx`)
  }

  if (!(await indexExists(prisma, 'CakeCalendarBlock_locationId_startDate_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeCalendarBlock_locationId_startDate_idx" ON "CakeCalendarBlock" ("locationId", "startDate")`)
    console.log(`${PREFIX} Created CakeCalendarBlock_locationId_startDate_idx`)
  }

  console.log(`${PREFIX} Migration 071 complete`)
}
