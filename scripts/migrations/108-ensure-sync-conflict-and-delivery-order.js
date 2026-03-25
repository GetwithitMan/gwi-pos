/**
 * Migration 108 — Ensure SyncConflict + DeliveryOrder tables exist
 *
 * Both tables were created by earlier raw-SQL migrations (075 and 032/066)
 * but were missing from prisma/schema.prisma, so `prisma db push` would
 * drop them on NUCs.  This migration is idempotent — it uses CREATE TABLE
 * IF NOT EXISTS so it's safe on NUCs that still have the tables and on
 * fresh installs that don't.
 *
 * Fixes:
 *   - SyncConflict: 228+ error-level logs per 5 min from quarantine worker
 *   - DeliveryOrder: KDS fails to fetch delivery info on every poll
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[108]'

  // ─── SyncConflict ──────────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'SyncConflict'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "SyncConflict" (
        "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "model"        TEXT NOT NULL,
        "recordId"     TEXT NOT NULL,
        "localVersion" TEXT NOT NULL,
        "cloudVersion" TEXT NOT NULL,
        "localData"    JSONB NOT NULL DEFAULT '{}',
        "cloudData"    JSONB NOT NULL DEFAULT '{}',
        "detectedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "resolvedAt"   TIMESTAMPTZ,
        "resolution"   TEXT
      )
    `)
    console.log(`${PREFIX} Created SyncConflict table`)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SyncConflict_resolvedAt_idx" ON "SyncConflict" ("resolvedAt") WHERE "resolvedAt" IS NULL
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SyncConflict_detectedAt_idx" ON "SyncConflict" ("detectedAt")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "SyncConflict_model_recordId_idx" ON "SyncConflict" ("model", "recordId")
    `)
    console.log(`${PREFIX} Created SyncConflict indexes`)
  } else {
    console.log(`${PREFIX} SyncConflict table already exists`)
  }

  // ─── DeliveryOrder ─────────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryOrder'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryOrder" (
        "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"          TEXT NOT NULL,
        "orderId"             TEXT,
        "employeeId"          TEXT,
        "driverId"            TEXT,
        "customerName"        TEXT NOT NULL,
        "phone"               TEXT,
        "address"             TEXT,
        "addressLine2"        TEXT,
        "city"                TEXT,
        "state"               TEXT,
        "zipCode"             TEXT,
        "notes"               TEXT,
        "status"              TEXT NOT NULL DEFAULT 'pending',
        "deliveryFee"         DECIMAL(10,2) NOT NULL DEFAULT 0,
        "estimatedMinutes"    INTEGER NOT NULL DEFAULT 45,
        "scheduledFor"        TIMESTAMP(3),
        "preparedAt"          TIMESTAMP(3),
        "readyAt"             TIMESTAMP(3),
        "dispatchedAt"        TIMESTAMP(3),
        "deliveredAt"         TIMESTAMP(3),
        "cancelledAt"         TIMESTAMP(3),
        "cancelReason"        TEXT,
        "zoneId"              TEXT,
        "runId"               TEXT,
        "runSequence"         INTEGER,
        "trackingToken"       TEXT,
        "addressId"           TEXT,
        "latitude"            DECIMAL(10,7),
        "longitude"           DECIMAL(10,7),
        "geocodePrecision"    TEXT,
        "geocodeConfidence"   DECIMAL(3,2),
        "smsNotificationsSent" JSONB DEFAULT '[]',
        "confirmedAt"         TIMESTAMP(3),
        "assignedAt"          TIMESTAMP(3),
        "enRouteAt"           TIMESTAMP(3),
        "arrivedAt"           TIMESTAMP(3),
        "attemptedAt"         TIMESTAMP(3),
        "failedAt"            TIMESTAMP(3),
        "returnedAt"          TIMESTAMP(3),
        "promisedAt"          TIMESTAMP(3),
        "quotedMinutes"       INTEGER,
        "serviceRecoveryReason" TEXT,
        "exceptionId"         TEXT,
        "addressSnapshotJson" JSONB,
        "proofMode"           TEXT,
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
      )
    `)
    console.log(`${PREFIX} Created DeliveryOrder table`)

    // Indexes from migration 032
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_locationId_status_idx" ON "DeliveryOrder" ("locationId", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_driverId_idx" ON "DeliveryOrder" ("driverId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_orderId_idx" ON "DeliveryOrder" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_locationId_createdAt_idx" ON "DeliveryOrder" ("locationId", "createdAt" DESC)`)
    // Indexes from migration 066
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryOrder_trackingToken_key" ON "DeliveryOrder" ("trackingToken")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryOrder_zoneId_idx" ON "DeliveryOrder" ("zoneId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryOrder_runId_idx" ON "DeliveryOrder" ("runId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryOrder_promisedAt_idx" ON "DeliveryOrder" ("promisedAt") WHERE "promisedAt" IS NOT NULL`)
    console.log(`${PREFIX} Created DeliveryOrder indexes`)
  } else {
    console.log(`${PREFIX} DeliveryOrder table already exists`)
  }

  console.log(`${PREFIX} Migration 108 complete`)
}
