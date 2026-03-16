/**
 * Migration 066 — Delivery Management System
 *
 * Creates 12 new tables:
 *   DeliveryZone, DeliveryDriver, DeliveryDriverDocument, DeliveryDriverSession,
 *   DeliveryRun, DeliveryAddress, DeliveryProofOfDelivery, DeliveryTracking,
 *   DeliveryAuditLog, DeliveryException, DeliveryNotification, DeliveryNotificationAttempt
 *
 * Alters existing DeliveryOrder table with new columns, constraints, and indexes.
 */

const { tableExists, columnExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-066]'

  // ─── 1. DeliveryZone ──────────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryZone'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryZone" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "color" TEXT NOT NULL DEFAULT '#3B82F6',
        "zoneType" TEXT NOT NULL DEFAULT 'radius' CHECK ("zoneType" IN ('radius', 'polygon', 'zipcode')),
        "radiusMiles" DECIMAL(6,2),
        "centerLat" DECIMAL(10,7),
        "centerLng" DECIMAL(10,7),
        "polygonJson" JSONB,
        "zipCodes" TEXT[],
        "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK ("deliveryFee" >= 0),
        "minimumOrder" DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK ("minimumOrder" >= 0),
        "estimatedMinutes" INTEGER NOT NULL DEFAULT 45 CHECK ("estimatedMinutes" > 0),
        "cutoffTime" TEXT,
        "cutoffDays" JSONB,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryZone_locationId_isActive_idx" ON "DeliveryZone" ("locationId", "isActive")
    `)
    console.log(`${PREFIX} Created DeliveryZone table + index`)
  } else {
    console.log(`${PREFIX} DeliveryZone table already exists`)
  }

  // ─── 2. DeliveryDriver ────────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryDriver'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryDriver" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "vehicleType" TEXT CHECK ("vehicleType" IN ('car', 'bike', 'scooter', 'other')),
        "vehicleMake" TEXT,
        "vehicleModel" TEXT,
        "vehicleColor" TEXT,
        "licensePlate" TEXT,
        "mileageRateOverride" DECIMAL(6,4),
        "preferredZoneIds" TEXT[] DEFAULT '{}',
        "isSuspended" BOOLEAN NOT NULL DEFAULT false,
        "suspendedAt" TIMESTAMP(3),
        "suspendedReason" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryDriver_locationId_employeeId_key" ON "DeliveryDriver" ("locationId", "employeeId")
    `)
    console.log(`${PREFIX} Created DeliveryDriver table + unique index`)
  } else {
    console.log(`${PREFIX} DeliveryDriver table already exists`)
  }

  // ─── 3. DeliveryDriverDocument ────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryDriverDocument'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryDriverDocument" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "driverId" TEXT NOT NULL REFERENCES "DeliveryDriver"("id"),
        "documentType" TEXT NOT NULL CHECK ("documentType" IN ('drivers_license', 'insurance', 'vehicle_registration', 'background_check', 'other')),
        "documentNumber" TEXT,
        "expiresAt" DATE,
        "verifiedAt" TIMESTAMP(3),
        "verifiedBy" TEXT,
        "storageKey" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryDriverDocument_driverId_idx" ON "DeliveryDriverDocument" ("driverId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryDriverDocument_expiresAt_idx" ON "DeliveryDriverDocument" ("expiresAt") WHERE "deletedAt" IS NULL
    `)
    console.log(`${PREFIX} Created DeliveryDriverDocument table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryDriverDocument table already exists`)
  }

  // ─── 4. DeliveryDriverSession ─────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryDriverSession'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryDriverSession" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "driverId" TEXT NOT NULL REFERENCES "DeliveryDriver"("id"),
        "timeClockEntryId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'available' CHECK ("status" IN ('available', 'on_delivery', 'returning', 'break', 'off_duty')),
        "startingBankCents" INTEGER NOT NULL DEFAULT 0,
        "cashCollectedCents" INTEGER NOT NULL DEFAULT 0,
        "cashDroppedCents" INTEGER NOT NULL DEFAULT 0,
        "cashTipsDeclaredCents" INTEGER NOT NULL DEFAULT 0,
        "deliveryCount" INTEGER NOT NULL DEFAULT 0,
        "shiftMileage" DECIMAL(8,2) NOT NULL DEFAULT 0,
        "lastLocationLat" DECIMAL(10,7),
        "lastLocationLng" DECIMAL(10,7),
        "lastLocationAt" TIMESTAMP(3),
        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endedAt" TIMESTAMP(3),
        "checkoutJson" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryDriverSession_active_unique" ON "DeliveryDriverSession" ("employeeId") WHERE "endedAt" IS NULL AND "deletedAt" IS NULL
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryDriverSession_locationId_status_idx" ON "DeliveryDriverSession" ("locationId", "status")
    `)
    console.log(`${PREFIX} Created DeliveryDriverSession table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryDriverSession table already exists`)
  }

  // ─── 5. DeliveryRun ───────────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryRun'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryRun" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "driverId" TEXT NOT NULL REFERENCES "DeliveryDriver"("id"),
        "sessionId" TEXT REFERENCES "DeliveryDriverSession"("id"),
        "originalRunId" TEXT REFERENCES "DeliveryRun"("id"),
        "status" TEXT NOT NULL DEFAULT 'assigned' CHECK ("status" IN ('assigned', 'handoff_ready', 'dispatched', 'in_progress', 'completed', 'returned', 'cancelled')),
        "assignmentMode" TEXT NOT NULL DEFAULT 'manual',
        "orderSequence" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("orderSequence") = 'array'),
        "routeJson" JSONB,
        "startOdometer" DECIMAL(10,1),
        "endOdometer" DECIMAL(10,1),
        "calculatedMiles" DECIMAL(8,2),
        "promisedAt" TIMESTAMP(3),
        "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "handoffAt" TIMESTAMP(3),
        "dispatchedAt" TIMESTAMP(3),
        "startedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "returnedAt" TIMESTAMP(3),
        "cancelledAt" TIMESTAMP(3),
        "failedCashHandling" TEXT CHECK ("failedCashHandling" IN ('returned', 'held_for_redelivery', 'customer_refunded')),
        "exceptionStatus" TEXT CHECK ("exceptionStatus" IN ('active', 'resolved')),
        "notes" TEXT,
        "idempotencyKey" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryRun_locationId_status_idx" ON "DeliveryRun" ("locationId", "status")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryRun_driverId_idx" ON "DeliveryRun" ("driverId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryRun_locationId_dispatchedAt_idx" ON "DeliveryRun" ("locationId", "dispatchedAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryRun_idempotencyKey_key" ON "DeliveryRun" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryRun_driver_active_unique" ON "DeliveryRun" ("driverId") WHERE "status" IN ('assigned', 'handoff_ready', 'dispatched', 'in_progress') AND "deletedAt" IS NULL
    `)
    console.log(`${PREFIX} Created DeliveryRun table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryRun table already exists`)
  }

  // ─── 6. DeliveryAddress ───────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryAddress'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryAddress" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "customerId" TEXT,
        "label" TEXT,
        "address" TEXT NOT NULL,
        "addressLine2" TEXT,
        "city" TEXT NOT NULL,
        "state" TEXT NOT NULL,
        "zipCode" TEXT NOT NULL,
        "phone" TEXT,
        "deliveryNotes" TEXT,
        "latitude" DECIMAL(10,7),
        "longitude" DECIMAL(10,7),
        "geocodePrecision" TEXT CHECK ("geocodePrecision" IN ('rooftop', 'interpolated', 'approximate', 'manual')),
        "geocodeConfidence" DECIMAL(3,2) CHECK ("geocodeConfidence" >= 0 AND "geocodeConfidence" <= 1),
        "normalizedAddressJson" JSONB,
        "zoneId" TEXT,
        "isFlagged" BOOLEAN NOT NULL DEFAULT false,
        "flagReason" TEXT,
        "isRestricted" BOOLEAN NOT NULL DEFAULT false,
        "isDefault" BOOLEAN NOT NULL DEFAULT false,
        "requiresApartmentUnit" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryAddress_locationId_customerId_idx" ON "DeliveryAddress" ("locationId", "customerId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryAddress_zipCode_idx" ON "DeliveryAddress" ("zipCode")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryAddress_default_unique" ON "DeliveryAddress" ("locationId", "customerId") WHERE "isDefault" = true AND "deletedAt" IS NULL
    `)
    console.log(`${PREFIX} Created DeliveryAddress table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryAddress table already exists`)
  }

  // ─── 7. DeliveryProofOfDelivery ───────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryProofOfDelivery'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryProofOfDelivery" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "deliveryOrderId" TEXT NOT NULL REFERENCES "DeliveryOrder"("id"),
        "type" TEXT NOT NULL CHECK ("type" IN ('photo', 'signature')),
        "storageKey" TEXT NOT NULL,
        "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "capturedByEmployeeId" TEXT,
        "latitude" DECIMAL(10,7),
        "longitude" DECIMAL(10,7),
        "idempotencyKey" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryProofOfDelivery_deliveryOrderId_idx" ON "DeliveryProofOfDelivery" ("deliveryOrderId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryProofOfDelivery_idempotencyKey_key" ON "DeliveryProofOfDelivery" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL
    `)
    console.log(`${PREFIX} Created DeliveryProofOfDelivery table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryProofOfDelivery table already exists`)
  }

  // ─── 8. DeliveryTracking ──────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryTracking'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryTracking" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "driverId" TEXT NOT NULL REFERENCES "DeliveryDriver"("id"),
        "runId" TEXT REFERENCES "DeliveryRun"("id"),
        "deliveryOrderId" TEXT REFERENCES "DeliveryOrder"("id"),
        "lat" DECIMAL(10,7) NOT NULL,
        "lng" DECIMAL(10,7) NOT NULL,
        "accuracy" REAL,
        "speed" REAL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryTracking_driverId_recordedAt_idx" ON "DeliveryTracking" ("driverId", "recordedAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryTracking_locationId_recordedAt_idx" ON "DeliveryTracking" ("locationId", "recordedAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryTracking_runId_idx" ON "DeliveryTracking" ("runId")
    `)
    console.log(`${PREFIX} Created DeliveryTracking table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryTracking table already exists`)
  }

  // ─── 9. DeliveryAuditLog ──────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryAuditLog'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryAuditLog" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "deliveryOrderId" TEXT,
        "runId" TEXT,
        "driverId" TEXT,
        "employeeId" TEXT NOT NULL,
        "previousValue" JSONB,
        "newValue" JSONB,
        "reason" TEXT,
        "idempotencyKey" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryAuditLog_locationId_createdAt_idx" ON "DeliveryAuditLog" ("locationId", "createdAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryAuditLog_deliveryOrderId_idx" ON "DeliveryAuditLog" ("deliveryOrderId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryAuditLog_idempotencyKey_key" ON "DeliveryAuditLog" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL
    `)
    console.log(`${PREFIX} Created DeliveryAuditLog table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryAuditLog table already exists`)
  }

  // ─── 10. DeliveryException ────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryException'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryException" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "deliveryOrderId" TEXT REFERENCES "DeliveryOrder"("id"),
        "runId" TEXT REFERENCES "DeliveryRun"("id"),
        "driverId" TEXT REFERENCES "DeliveryDriver"("id"),
        "type" TEXT NOT NULL,
        "severity" TEXT NOT NULL CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
        "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'acknowledged', 'resolved')),
        "description" TEXT,
        "resolution" TEXT,
        "resolvedBy" TEXT,
        "resolvedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryException_locationId_status_idx" ON "DeliveryException" ("locationId", "status")
    `)
    console.log(`${PREFIX} Created DeliveryException table + index`)
  } else {
    console.log(`${PREFIX} DeliveryException table already exists`)
  }

  // ─── 11. DeliveryNotification ─────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryNotification'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryNotification" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "deliveryOrderId" TEXT NOT NULL REFERENCES "DeliveryOrder"("id"),
        "channel" TEXT NOT NULL CHECK ("channel" IN ('sms', 'push')),
        "event" TEXT NOT NULL,
        "recipient" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed')),
        "maxRetries" INTEGER NOT NULL DEFAULT 2 CHECK ("maxRetries" >= 0),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryNotification_deliveryOrderId_idx" ON "DeliveryNotification" ("deliveryOrderId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryNotification_dedup" ON "DeliveryNotification" ("locationId", "deliveryOrderId", "event", "channel")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryNotification_locationId_createdAt_idx" ON "DeliveryNotification" ("locationId", "createdAt" DESC)
    `)
    console.log(`${PREFIX} Created DeliveryNotification table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryNotification table already exists`)
  }

  // ─── 12. DeliveryNotificationAttempt ──────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryNotificationAttempt'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryNotificationAttempt" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "notificationId" TEXT NOT NULL REFERENCES "DeliveryNotification"("id"),
        "attemptNumber" INTEGER NOT NULL,
        "status" TEXT NOT NULL CHECK ("status" IN ('queued', 'sent', 'delivered', 'failed')),
        "providerRef" TEXT,
        "errorMessage" TEXT,
        "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "DeliveryNotificationAttempt_notificationId_idx" ON "DeliveryNotificationAttempt" ("notificationId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "DeliveryNotificationAttempt_unique" ON "DeliveryNotificationAttempt" ("notificationId", "attemptNumber")
    `)
    console.log(`${PREFIX} Created DeliveryNotificationAttempt table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryNotificationAttempt table already exists`)
  }

  // ─── ALTER DeliveryOrder — add new columns ────────────────────────────────────
  const deliveryOrderColumns = [
    { name: 'zoneId', sql: '"zoneId" TEXT' },
    { name: 'runId', sql: '"runId" TEXT' },
    { name: 'runSequence', sql: '"runSequence" INTEGER' },
    { name: 'trackingToken', sql: '"trackingToken" TEXT' },
    { name: 'addressId', sql: '"addressId" TEXT' },
    { name: 'latitude', sql: '"latitude" DECIMAL(10,7)' },
    { name: 'longitude', sql: '"longitude" DECIMAL(10,7)' },
    { name: 'geocodePrecision', sql: '"geocodePrecision" TEXT' },
    { name: 'geocodeConfidence', sql: '"geocodeConfidence" DECIMAL(3,2)' },
    { name: 'smsNotificationsSent', sql: `"smsNotificationsSent" JSONB DEFAULT '[]'` },
    { name: 'confirmedAt', sql: '"confirmedAt" TIMESTAMP(3)' },
    { name: 'assignedAt', sql: '"assignedAt" TIMESTAMP(3)' },
    { name: 'enRouteAt', sql: '"enRouteAt" TIMESTAMP(3)' },
    { name: 'arrivedAt', sql: '"arrivedAt" TIMESTAMP(3)' },
    { name: 'attemptedAt', sql: '"attemptedAt" TIMESTAMP(3)' },
    { name: 'failedAt', sql: '"failedAt" TIMESTAMP(3)' },
    { name: 'returnedAt', sql: '"returnedAt" TIMESTAMP(3)' },
    { name: 'promisedAt', sql: '"promisedAt" TIMESTAMP(3)' },
    { name: 'quotedMinutes', sql: '"quotedMinutes" INTEGER' },
    { name: 'cancelReason', sql: '"cancelReason" TEXT', skip: true },
    { name: 'serviceRecoveryReason', sql: '"serviceRecoveryReason" TEXT' },
    { name: 'exceptionId', sql: '"exceptionId" TEXT' },
    { name: 'addressSnapshotJson', sql: '"addressSnapshotJson" JSONB' },
    { name: 'proofMode', sql: '"proofMode" TEXT' },
  ]

  for (const col of deliveryOrderColumns) {
    if (!(await columnExists(prisma, 'DeliveryOrder', col.name))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "DeliveryOrder" ADD COLUMN ${col.sql}`)
      console.log(`${PREFIX} Added DeliveryOrder.${col.name}`)
    } else {
      if (!col.skip) {
        console.log(`${PREFIX} DeliveryOrder.${col.name} already exists`)
      }
    }
  }

  // ─── CHECK constraints (add NOT VALID first, then VALIDATE) ───────────────────
  // geocodePrecision check
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "DeliveryOrder"
      ADD CONSTRAINT "DeliveryOrder_geocodePrecision_check"
      CHECK ("geocodePrecision" IN ('rooftop', 'interpolated', 'approximate', 'manual'))
      NOT VALID
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "DeliveryOrder" VALIDATE CONSTRAINT "DeliveryOrder_geocodePrecision_check"
    `)
    console.log(`${PREFIX} Added DeliveryOrder geocodePrecision CHECK constraint`)
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      console.log(`${PREFIX} DeliveryOrder geocodePrecision CHECK constraint already exists`)
    } else {
      throw e
    }
  }

  // geocodeConfidence check
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "DeliveryOrder"
      ADD CONSTRAINT "DeliveryOrder_geocodeConfidence_check"
      CHECK ("geocodeConfidence" >= 0 AND "geocodeConfidence" <= 1)
      NOT VALID
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "DeliveryOrder" VALIDATE CONSTRAINT "DeliveryOrder_geocodeConfidence_check"
    `)
    console.log(`${PREFIX} Added DeliveryOrder geocodeConfidence CHECK constraint`)
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      console.log(`${PREFIX} DeliveryOrder geocodeConfidence CHECK constraint already exists`)
    } else {
      throw e
    }
  }

  // proofMode check
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "DeliveryOrder"
      ADD CONSTRAINT "DeliveryOrder_proofMode_check"
      CHECK ("proofMode" IN ('none', 'photo', 'signature', 'photo_and_signature'))
      NOT VALID
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "DeliveryOrder" VALIDATE CONSTRAINT "DeliveryOrder_proofMode_check"
    `)
    console.log(`${PREFIX} Added DeliveryOrder proofMode CHECK constraint`)
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      console.log(`${PREFIX} DeliveryOrder proofMode CHECK constraint already exists`)
    } else {
      throw e
    }
  }

  // ─── Backfill trackingToken on existing rows ──────────────────────────────────
  await prisma.$executeRawUnsafe(`
    UPDATE "DeliveryOrder" SET "trackingToken" = gen_random_uuid()::text WHERE "trackingToken" IS NULL
  `)
  console.log(`${PREFIX} Backfilled trackingToken on existing DeliveryOrder rows`)

  // ─── Indexes on DeliveryOrder ─────────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryOrder_trackingToken_key" ON "DeliveryOrder" ("trackingToken")
  `)
  console.log(`${PREFIX} Ensured DeliveryOrder_trackingToken_key unique index`)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "DeliveryOrder_zoneId_idx" ON "DeliveryOrder" ("zoneId")
  `)
  console.log(`${PREFIX} Ensured DeliveryOrder_zoneId_idx index`)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "DeliveryOrder_runId_idx" ON "DeliveryOrder" ("runId")
  `)
  console.log(`${PREFIX} Ensured DeliveryOrder_runId_idx index`)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "DeliveryOrder_promisedAt_idx" ON "DeliveryOrder" ("promisedAt") WHERE "promisedAt" IS NOT NULL
  `)
  console.log(`${PREFIX} Ensured DeliveryOrder_promisedAt_idx index`)

  console.log(`${PREFIX} Migration complete`)
}
