/**
 * Migration 130 — Entertainment Session Entities (Phase 1: Server Foundation)
 *
 * Creates the core tables for the entertainment session state machine:
 *   1. EntertainmentSession — tracks lifecycle of a timed rental session
 *   2. EntertainmentSessionEvent — event-sourced audit trail per session
 *   3. EntertainmentResource — canonical resource registry (seeded from FloorPlanElement)
 *
 * Also backfills:
 *   - EntertainmentResource from existing FloorPlanElement + MenuItem pairs
 *   - EntertainmentSession for any currently-running timed rental OrderItems
 *
 * Additive only. All DDL is guarded with tableExists / indexExists.
 */

const { tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[130]'

  // ─── 1. Create EntertainmentSessionState enum ────────────────────────────
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntertainmentSessionState') THEN
        CREATE TYPE "EntertainmentSessionState" AS ENUM (
          'pre_start', 'running', 'overtime', 'stopped', 'voided', 'comped', 'cancelled'
        );
      END IF;
    END $$
  `)
  console.log(`${PREFIX} Ensured EntertainmentSessionState enum`)

  // ─── 2. Create EntertainmentSessionEventType enum ────────────────────────
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntertainmentSessionEventType') THEN
        CREATE TYPE "EntertainmentSessionEventType" AS ENUM (
          'created', 'started', 'extended', 'overtime_entered', 'stopped',
          'voided', 'comped', 'cancelled', 'transferred', 'price_updated',
          'resource_assigned', 'waitlist_notified'
        );
      END IF;
    END $$
  `)
  console.log(`${PREFIX} Ensured EntertainmentSessionEventType enum`)

  // ─── 3. EntertainmentSession table ───────────────────────────────────────
  if (!(await tableExists(prisma, 'EntertainmentSession'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "EntertainmentSession" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderItemId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "resourceId" TEXT NOT NULL,
        "sessionState" "EntertainmentSessionState" NOT NULL DEFAULT 'pre_start',
        "version" INTEGER NOT NULL DEFAULT 1,
        "scheduledMinutes" INTEGER,
        "startedAt" TIMESTAMP(3),
        "bookedEndAt" TIMESTAMP(3),
        "stoppedAt" TIMESTAMP(3),
        "overtimeStartedAt" TIMESTAMP(3),
        "lastExtendedAt" TIMESTAMP(3),
        "totalExtendedMinutes" INTEGER NOT NULL DEFAULT 0,
        "pricingSnapshot" JSONB,
        "finalPriceCents" INTEGER,
        "finalPriceDollars" DECIMAL(10,2),
        "createdBy" TEXT,
        "stoppedBy" TEXT,
        "stopReason" TEXT,
        "sourceTerminalId" TEXT,
        "lastMutatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3),
        CONSTRAINT "EntertainmentSession_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "EntertainmentSession_orderItemId_key" UNIQUE ("orderItemId"),
        CONSTRAINT "EntertainmentSession_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "EntertainmentSession_orderItemId_fkey"
          FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "EntertainmentSession_orderId_fkey"
          FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created EntertainmentSession table`)
  }

  // ─── 4. EntertainmentSessionEvent table ──────────────────────────────────
  if (!(await tableExists(prisma, 'EntertainmentSessionEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "EntertainmentSessionEvent" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "sessionId" TEXT NOT NULL,
        "eventType" "EntertainmentSessionEventType" NOT NULL,
        "payload" JSONB,
        "actorId" TEXT,
        "idempotencyKey" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EntertainmentSessionEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "EntertainmentSessionEvent_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "EntertainmentSessionEvent_sessionId_fkey"
          FOREIGN KEY ("sessionId") REFERENCES "EntertainmentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created EntertainmentSessionEvent table`)
  }

  // ─── 5. EntertainmentResource table ──────────────────────────────────────
  if (!(await tableExists(prisma, 'EntertainmentResource'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "EntertainmentResource" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "resourceType" TEXT NOT NULL,
        "capacity" INTEGER NOT NULL DEFAULT 1,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'available',
        "linkedMenuItemId" TEXT,
        "linkedFloorPlanElementId" TEXT,
        "activeSessionId" TEXT,
        "isBookable" BOOLEAN NOT NULL DEFAULT true,
        "defaultPricingPolicyId" TEXT,
        "lastMutatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3),
        CONSTRAINT "EntertainmentResource_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "EntertainmentResource_activeSessionId_key" UNIQUE ("activeSessionId"),
        CONSTRAINT "EntertainmentResource_locationId_name_key" UNIQUE ("locationId", "name"),
        CONSTRAINT "EntertainmentResource_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created EntertainmentResource table`)
  }

  // ─── 6. Indices ──────────────────────────────────────────────────────────
  const idxSpecs = [
    // EntertainmentSession indices
    {
      name: 'EntertainmentSession_locationId_idx',
      sql: `CREATE INDEX "EntertainmentSession_locationId_idx" ON "EntertainmentSession"("locationId")`,
    },
    {
      name: 'EntertainmentSession_orderId_idx',
      sql: `CREATE INDEX "EntertainmentSession_orderId_idx" ON "EntertainmentSession"("orderId")`,
    },
    {
      name: 'EntertainmentSession_resourceId_idx',
      sql: `CREATE INDEX "EntertainmentSession_resourceId_idx" ON "EntertainmentSession"("resourceId")`,
    },
    {
      name: 'EntertainmentSession_sessionState_idx',
      sql: `CREATE INDEX "EntertainmentSession_sessionState_idx" ON "EntertainmentSession"("sessionState")`,
    },
    {
      name: 'EntertainmentSession_locationId_sessionState_idx',
      sql: `CREATE INDEX "EntertainmentSession_locationId_sessionState_idx" ON "EntertainmentSession"("locationId", "sessionState")`,
    },
    // EntertainmentSessionEvent indices
    {
      name: 'EntertainmentSessionEvent_sessionId_idx',
      sql: `CREATE INDEX "EntertainmentSessionEvent_sessionId_idx" ON "EntertainmentSessionEvent"("sessionId")`,
    },
    {
      name: 'EntertainmentSessionEvent_locationId_createdAt_idx',
      sql: `CREATE INDEX "EntertainmentSessionEvent_locationId_createdAt_idx" ON "EntertainmentSessionEvent"("locationId", "createdAt")`,
    },
    {
      name: 'EntertainmentSessionEvent_sessionId_idempotencyKey_key',
      sql: `CREATE UNIQUE INDEX "EntertainmentSessionEvent_sessionId_idempotencyKey_key" ON "EntertainmentSessionEvent"("sessionId", "idempotencyKey")`,
    },
    // EntertainmentResource indices
    {
      name: 'EntertainmentResource_locationId_idx',
      sql: `CREATE INDEX "EntertainmentResource_locationId_idx" ON "EntertainmentResource"("locationId")`,
    },
    {
      name: 'EntertainmentResource_linkedMenuItemId_idx',
      sql: `CREATE INDEX "EntertainmentResource_linkedMenuItemId_idx" ON "EntertainmentResource"("linkedMenuItemId")`,
    },
    {
      name: 'EntertainmentResource_linkedFloorPlanElementId_idx',
      sql: `CREATE INDEX "EntertainmentResource_linkedFloorPlanElementId_idx" ON "EntertainmentResource"("linkedFloorPlanElementId")`,
    },
    {
      name: 'EntertainmentResource_status_idx',
      sql: `CREATE INDEX "EntertainmentResource_status_idx" ON "EntertainmentResource"("status")`,
    },
  ]

  for (const idx of idxSpecs) {
    if (!(await indexExists(prisma, idx.name))) {
      await prisma.$executeRawUnsafe(idx.sql)
      console.log(`${PREFIX} Created index ${idx.name}`)
    }
  }

  // ─── 7. Seed EntertainmentResource from FloorPlanElement ─────────────────
  const seeded = await prisma.$executeRawUnsafe(`
    INSERT INTO "EntertainmentResource" ("id", "locationId", "name", "resourceType", "status", "linkedMenuItemId", "linkedFloorPlanElementId", "activeSessionId", "isBookable", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      fpe."locationId",
      fpe."name",
      COALESCE(fpe."visualType", 'entertainment'),
      COALESCE(fpe."status"::text, 'available'),
      fpe."linkedMenuItemId",
      fpe."id",
      NULL,
      true,
      NOW(),
      NOW()
    FROM "FloorPlanElement" fpe
    WHERE fpe."elementType" = 'entertainment'
      AND fpe."linkedMenuItemId" IS NOT NULL
      AND fpe."deletedAt" IS NULL
    ON CONFLICT DO NOTHING
  `)
  console.log(`${PREFIX} Seeded EntertainmentResource from FloorPlanElement (${seeded} rows)`)

  // ─── 8. Backfill active sessions from running timed rentals ──────────────
  const backfilled = await prisma.$executeRawUnsafe(`
    INSERT INTO "EntertainmentSession" ("id", "locationId", "orderItemId", "orderId", "resourceId", "sessionState", "version", "scheduledMinutes", "startedAt", "bookedEndAt", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      oi."locationId",
      oi."id",
      oi."orderId",
      COALESCE(er."id", ''),
      CASE
        WHEN oi."blockTimeExpiresAt" IS NOT NULL AND oi."blockTimeExpiresAt" < NOW() THEN 'overtime'::"EntertainmentSessionState"
        ELSE 'running'::"EntertainmentSessionState"
      END,
      1,
      oi."blockTimeMinutes",
      oi."blockTimeStartedAt",
      oi."blockTimeExpiresAt",
      NOW(),
      NOW()
    FROM "OrderItem" oi
    JOIN "MenuItem" mi ON oi."menuItemId" = mi."id"
    LEFT JOIN "EntertainmentResource" er ON er."linkedMenuItemId" = mi."id" AND er."locationId" = oi."locationId"
    WHERE mi."itemType" = 'timed_rental'
      AND oi."blockTimeStartedAt" IS NOT NULL
      AND mi."entertainmentStatus" = 'in_use'
      AND oi."deletedAt" IS NULL
    ON CONFLICT ("orderItemId") DO NOTHING
  `)
  console.log(`${PREFIX} Backfilled active EntertainmentSession rows (${backfilled} rows)`)

  console.log(`${PREFIX} Migration complete`)
}

module.exports = { up }
