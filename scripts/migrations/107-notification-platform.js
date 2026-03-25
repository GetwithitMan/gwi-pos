/**
 * Migration 107 — Notification Platform (Phase 1)
 *
 * Creates:
 *   NotificationJob            — one row per logical notification workflow
 *   NotificationAttempt        — immutable delivery execution log
 *   NotificationProvider       — vendor-neutral provider configs per location
 *   NotificationDevice         — physical pager/device inventory
 *   NotificationDeviceEvent    — device lifecycle audit trail
 *   NotificationTargetAssignment — who/what to notify (source of truth)
 *   NotificationRoutingRule    — event-to-provider routing rules
 *   NotificationTemplate       — message templates per event/channel
 *
 * Alters:
 *   Order         — +pagerNumber, +fulfillmentMode, +readyCycleCounter
 *   WaitlistEntry — +pagerNumber, +version (raw SQL table)
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[107]'

  // ─── 1. NotificationJob ──────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationJob'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationJob" (
        "id"                  TEXT NOT NULL PRIMARY KEY,
        "locationId"          TEXT NOT NULL,
        "eventType"           TEXT NOT NULL,
        "subjectType"         TEXT NOT NULL,
        "subjectId"           TEXT NOT NULL,
        "status"              TEXT NOT NULL DEFAULT 'pending',
        "currentAttempt"      INTEGER NOT NULL DEFAULT 0,
        "maxAttempts"         INTEGER NOT NULL DEFAULT 3,
        "terminalResult"      TEXT,
        "dispatchOrigin"      TEXT NOT NULL,
        "businessStage"       TEXT NOT NULL,
        "executionStage"      TEXT NOT NULL,
        "routingRuleId"       TEXT,
        "providerId"          TEXT NOT NULL,
        "fallbackProviderId"  TEXT,
        "targetType"          TEXT NOT NULL,
        "targetValue"         TEXT NOT NULL,
        "scheduledFor"        TIMESTAMP(3),
        "availableAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "executionZone"       TEXT NOT NULL DEFAULT 'any',
        "claimedByWorkerId"   TEXT,
        "claimedAt"           TIMESTAMP(3),
        "processingTimeoutAt" TIMESTAMP(3),
        "contextSnapshot"     JSONB NOT NULL,
        "messageTemplate"     TEXT,
        "messageRendered"     TEXT,
        "policySnapshot"      JSONB NOT NULL,
        "ruleExplainSnapshot" JSONB,
        "subjectVersion"      INTEGER NOT NULL,
        "isProbe"             BOOLEAN NOT NULL DEFAULT false,
        "sourceSystem"        TEXT NOT NULL,
        "sourceEventId"       TEXT NOT NULL,
        "sourceEventVersion"  INTEGER NOT NULL DEFAULT 1,
        "idempotencyKey"      TEXT NOT NULL,
        "correlationId"       TEXT NOT NULL,
        "parentJobId"         TEXT,
        "notificationEngine"  TEXT NOT NULL,
        "lastAttemptAt"       TIMESTAMP(3),
        "resolvedAt"          TIMESTAMP(3),
        "resolvedByEmployeeId" TEXT,
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completedAt"         TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created NotificationJob table`)
  } else {
    console.log(`${PREFIX} NotificationJob table already exists`)
  }

  // NotificationJob CHECK constraint: policySnapshot NOT NULL
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "NotificationJob"
        ADD CONSTRAINT "NotificationJob_policySnapshot_not_null"
        CHECK ("policySnapshot" IS NOT NULL)
    `)
    console.log(`${PREFIX} Added NotificationJob_policySnapshot_not_null check`)
  } catch {
    console.log(`${PREFIX} NotificationJob_policySnapshot_not_null check already exists`)
  }

  // NotificationJob unique constraint: source event dedup
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "NotificationJob"
        ADD CONSTRAINT "NotificationJob_locationId_sourceSystem_sourceEventId_sourceEve_key"
        UNIQUE ("locationId", "sourceSystem", "sourceEventId", "sourceEventVersion")
    `)
    console.log(`${PREFIX} Added NotificationJob source event unique constraint`)
  } catch {
    console.log(`${PREFIX} NotificationJob source event unique constraint already exists`)
  }

  // NotificationJob indexes
  if (!(await indexExists(prisma, 'NotificationJob_correlationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationJob_correlationId_idx" ON "NotificationJob" ("correlationId")`)
    console.log(`${PREFIX} Created NotificationJob_correlationId_idx`)
  }
  if (!(await indexExists(prisma, 'NotificationJob_subjectType_subjectId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationJob_subjectType_subjectId_idx" ON "NotificationJob" ("subjectType", "subjectId")`)
    console.log(`${PREFIX} Created NotificationJob_subjectType_subjectId_idx`)
  }

  // Worker query index (partial — only pending jobs)
  if (!(await indexExists(prisma, 'NotificationJob_worker_query'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "NotificationJob_worker_query"
      ON "NotificationJob" ("locationId", "status", "availableAt", "executionZone")
      WHERE status = 'pending'
    `)
    console.log(`${PREFIX} Created NotificationJob_worker_query partial index`)
  }

  // ─── 2. NotificationAttempt ──────────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationAttempt'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationAttempt" (
        "id"                 TEXT NOT NULL PRIMARY KEY,
        "jobId"              TEXT NOT NULL,
        "providerId"         TEXT NOT NULL,
        "providerType"       TEXT NOT NULL,
        "targetType"         TEXT NOT NULL,
        "targetValue"        TEXT NOT NULL,
        "messageRendered"    TEXT,
        "attemptNumber"      INTEGER NOT NULL,
        "startedAt"          TIMESTAMP(3) NOT NULL,
        "completedAt"        TIMESTAMP(3),
        "result"             TEXT NOT NULL,
        "latencyMs"          INTEGER,
        "rawResponse"        TEXT,
        "providerMessageId"  TEXT,
        "providerStatusCode" TEXT,
        "deliveryConfidence" TEXT,
        "errorCode"          TEXT,
        "normalizedError"    TEXT,
        "isManual"           BOOLEAN NOT NULL DEFAULT false,
        "isRetry"            BOOLEAN NOT NULL DEFAULT false
      )
    `)
    console.log(`${PREFIX} Created NotificationAttempt table`)
  } else {
    console.log(`${PREFIX} NotificationAttempt table already exists`)
  }

  // NotificationAttempt indexes
  if (!(await indexExists(prisma, 'NotificationAttempt_jobId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationAttempt_jobId_idx" ON "NotificationAttempt" ("jobId")`)
    console.log(`${PREFIX} Created NotificationAttempt_jobId_idx`)
  }
  if (!(await indexExists(prisma, 'NotificationAttempt_providerId_startedAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationAttempt_providerId_startedAt_idx" ON "NotificationAttempt" ("providerId", "startedAt")`)
    console.log(`${PREFIX} Created NotificationAttempt_providerId_startedAt_idx`)
  }

  // ─── 3. NotificationProvider ─────────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationProvider'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationProvider" (
        "id"                      TEXT NOT NULL PRIMARY KEY,
        "locationId"              TEXT NOT NULL,
        "providerType"            TEXT NOT NULL,
        "name"                    TEXT NOT NULL,
        "isActive"                BOOLEAN NOT NULL DEFAULT true,
        "isDefault"               BOOLEAN NOT NULL DEFAULT false,
        "priority"                INTEGER NOT NULL DEFAULT 0,
        "executionZone"           TEXT NOT NULL DEFAULT 'any',
        "config"                  JSONB NOT NULL,
        "configVersion"           INTEGER NOT NULL DEFAULT 1,
        "lastValidatedAt"         TIMESTAMP(3),
        "lastValidationResult"    TEXT,
        "capabilities"            JSONB NOT NULL,
        "healthStatus"            TEXT NOT NULL DEFAULT 'healthy',
        "lastHealthCheckAt"       TIMESTAMP(3),
        "consecutiveFailures"     INTEGER NOT NULL DEFAULT 0,
        "circuitBreakerOpenUntil" TIMESTAMP(3),
        "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"               TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created NotificationProvider table`)
  } else {
    console.log(`${PREFIX} NotificationProvider table already exists`)
  }

  // NotificationProvider indexes
  if (!(await indexExists(prisma, 'NotificationProvider_locationId_isActive_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationProvider_locationId_isActive_idx" ON "NotificationProvider" ("locationId", "isActive")`)
    console.log(`${PREFIX} Created NotificationProvider_locationId_isActive_idx`)
  }

  // ─── 4. NotificationDevice ──────────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationDevice'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationDevice" (
        "id"                    TEXT NOT NULL PRIMARY KEY,
        "locationId"            TEXT NOT NULL,
        "providerId"            TEXT NOT NULL,
        "deviceNumber"          TEXT NOT NULL,
        "humanLabel"            TEXT,
        "deviceType"            TEXT NOT NULL,
        "status"                TEXT NOT NULL,
        "assignedToSubjectType" TEXT,
        "assignedToSubjectId"   TEXT,
        "assignedAt"            TIMESTAMP(3),
        "releasedAt"            TIMESTAMP(3),
        "returnedAt"            TIMESTAMP(3),
        "batteryLevel"          INTEGER,
        "lastSeenAt"            TIMESTAMP(3),
        "lastSignalState"       TEXT,
        "capcode"               TEXT,
        "firmwareVersion"       TEXT,
        "dockId"                TEXT,
        "dockSlot"              TEXT,
        "metadata"              JSONB,
        "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"             TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created NotificationDevice table`)
  } else {
    console.log(`${PREFIX} NotificationDevice table already exists`)
  }

  // NotificationDevice partial unique index: active devices
  if (!(await indexExists(prisma, 'NotificationDevice_active_unique'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "NotificationDevice_active_unique"
      ON "NotificationDevice" ("locationId", "deviceNumber")
      WHERE "deletedAt" IS NULL AND status NOT IN ('retired', 'disabled')
    `)
    console.log(`${PREFIX} Created NotificationDevice_active_unique partial index`)
  }

  // ─── 5. NotificationDeviceEvent ──────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationDeviceEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationDeviceEvent" (
        "id"          TEXT NOT NULL PRIMARY KEY,
        "deviceId"    TEXT NOT NULL,
        "locationId"  TEXT NOT NULL,
        "eventType"   TEXT NOT NULL,
        "subjectType" TEXT,
        "subjectId"   TEXT,
        "employeeId"  TEXT,
        "metadata"    JSONB,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log(`${PREFIX} Created NotificationDeviceEvent table`)
  } else {
    console.log(`${PREFIX} NotificationDeviceEvent table already exists`)
  }

  // NotificationDeviceEvent indexes
  if (!(await indexExists(prisma, 'NotificationDeviceEvent_deviceId_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationDeviceEvent_deviceId_createdAt_idx" ON "NotificationDeviceEvent" ("deviceId", "createdAt")`)
    console.log(`${PREFIX} Created NotificationDeviceEvent_deviceId_createdAt_idx`)
  }

  // ─── 6. NotificationTargetAssignment ─────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationTargetAssignment'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationTargetAssignment" (
        "id"                  TEXT NOT NULL PRIMARY KEY,
        "locationId"          TEXT NOT NULL,
        "subjectType"         TEXT NOT NULL,
        "subjectId"           TEXT NOT NULL,
        "targetType"          TEXT NOT NULL,
        "targetValue"         TEXT NOT NULL,
        "providerId"          TEXT,
        "priority"            INTEGER NOT NULL DEFAULT 0,
        "isPrimary"           BOOLEAN NOT NULL DEFAULT false,
        "source"              TEXT NOT NULL,
        "status"              TEXT NOT NULL,
        "assignedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "releasedAt"          TIMESTAMP(3),
        "expiresAt"           TIMESTAMP(3),
        "releaseReason"       TEXT,
        "createdByEmployeeId" TEXT,
        "lastUsedAt"          TIMESTAMP(3),
        "metadata"            JSONB,
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log(`${PREFIX} Created NotificationTargetAssignment table`)
  } else {
    console.log(`${PREFIX} NotificationTargetAssignment table already exists`)
  }

  // NotificationTargetAssignment indexes
  if (!(await indexExists(prisma, 'NotificationTargetAssignment_subjectType_subjectId_status_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationTargetAssignment_subjectType_subjectId_status_idx" ON "NotificationTargetAssignment" ("subjectType", "subjectId", "status")`)
    console.log(`${PREFIX} Created NotificationTargetAssignment subject+status index`)
  }

  // Partial unique index: active assignment uniqueness
  if (!(await indexExists(prisma, 'NotificationTargetAssignment_active_unique'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "NotificationTargetAssignment_active_unique"
      ON "NotificationTargetAssignment" ("subjectType", "subjectId", "targetType", "targetValue")
      WHERE status = 'active'
    `)
    console.log(`${PREFIX} Created NotificationTargetAssignment_active_unique partial index`)
  }

  // ─── 7. NotificationRoutingRule ──────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationRoutingRule'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationRoutingRule" (
        "id"                        TEXT NOT NULL PRIMARY KEY,
        "locationId"                TEXT NOT NULL,
        "eventType"                 TEXT NOT NULL,
        "providerId"                TEXT NOT NULL,
        "targetType"                TEXT NOT NULL,
        "enabled"                   BOOLEAN NOT NULL DEFAULT true,
        "priority"                  INTEGER NOT NULL DEFAULT 0,
        "messageTemplateId"         TEXT,
        "condFulfillmentMode"       TEXT,
        "condHasPager"              BOOLEAN,
        "condHasPhone"              BOOLEAN,
        "condMinPartySize"          INTEGER,
        "condOrderTypes"            TEXT[],
        "condDuringBusinessHours"   BOOLEAN,
        "retryMaxAttempts"          INTEGER NOT NULL DEFAULT 2,
        "retryDelayMs"              INTEGER NOT NULL DEFAULT 2000,
        "retryBackoffMultiplier"    DOUBLE PRECISION NOT NULL DEFAULT 1.5,
        "retryOnTimeout"            BOOLEAN NOT NULL DEFAULT false,
        "fallbackProviderId"        TEXT,
        "escalateToStaff"           BOOLEAN NOT NULL DEFAULT false,
        "alsoEmitDisplayProjection" BOOLEAN NOT NULL DEFAULT false,
        "stopProcessingAfterMatch"  BOOLEAN NOT NULL DEFAULT false,
        "cooldownSeconds"           INTEGER NOT NULL DEFAULT 0,
        "allowManualOverride"       BOOLEAN NOT NULL DEFAULT true,
        "criticalityClass"          TEXT NOT NULL DEFAULT 'standard',
        "effectiveStartAt"          TIMESTAMP(3),
        "effectiveEndAt"            TIMESTAMP(3),
        "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"                 TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created NotificationRoutingRule table`)
  } else {
    console.log(`${PREFIX} NotificationRoutingRule table already exists`)
  }

  // NotificationRoutingRule indexes
  if (!(await indexExists(prisma, 'NotificationRoutingRule_locationId_eventType_enabled_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "NotificationRoutingRule_locationId_eventType_enabled_idx" ON "NotificationRoutingRule" ("locationId", "eventType", "enabled")`)
    console.log(`${PREFIX} Created NotificationRoutingRule_locationId_eventType_enabled_idx`)
  }

  // ─── 8. NotificationTemplate ─────────────────────────────────────────────
  if (!(await tableExists(prisma, 'NotificationTemplate'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "NotificationTemplate" (
        "id"                TEXT NOT NULL PRIMARY KEY,
        "locationId"        TEXT NOT NULL,
        "name"              TEXT NOT NULL,
        "eventType"         TEXT NOT NULL,
        "channelType"       TEXT NOT NULL,
        "body"              TEXT NOT NULL,
        "locale"            TEXT NOT NULL DEFAULT 'en',
        "maxLength"         INTEGER,
        "version"           INTEGER NOT NULL DEFAULT 1,
        "isDefault"         BOOLEAN NOT NULL DEFAULT false,
        "requiredVariables" TEXT[] DEFAULT '{}',
        "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"         TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created NotificationTemplate table`)
  } else {
    console.log(`${PREFIX} NotificationTemplate table already exists`)
  }

  // ─── 9. Order additions ──────────────────────────────────────────────────
  if (!(await columnExists(prisma, 'Order', 'pagerNumber'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "pagerNumber" TEXT`)
    console.log(`${PREFIX} Added Order.pagerNumber`)
  }
  if (!(await columnExists(prisma, 'Order', 'fulfillmentMode'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "fulfillmentMode" TEXT`)
    console.log(`${PREFIX} Added Order.fulfillmentMode`)
  }
  if (!(await columnExists(prisma, 'Order', 'readyCycleCounter'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "readyCycleCounter" INTEGER NOT NULL DEFAULT 0`)
    console.log(`${PREFIX} Added Order.readyCycleCounter`)
  }

  // ─── 10. WaitlistEntry additions (raw SQL table) ────────────────────────
  if (await tableExists(prisma, 'WaitlistEntry')) {
    if (!(await columnExists(prisma, 'WaitlistEntry', 'pagerNumber'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "WaitlistEntry" ADD COLUMN "pagerNumber" TEXT`)
      console.log(`${PREFIX} Added WaitlistEntry.pagerNumber`)
    }
    if (!(await columnExists(prisma, 'WaitlistEntry', 'version'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "WaitlistEntry" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1`)
      console.log(`${PREFIX} Added WaitlistEntry.version`)
    }
  } else {
    console.log(`${PREFIX} WaitlistEntry table does not exist — skipping column additions`)
  }

  console.log(`${PREFIX} Migration 107 complete — Notification Platform Phase 1`)
}
