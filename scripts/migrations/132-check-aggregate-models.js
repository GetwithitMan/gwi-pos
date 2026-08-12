/**
 * Migration 132 — Check Aggregate Models
 *
 * Creates the five tables that power the Check Aggregate Redesign:
 *
 *   1. Check          — aggregate root (draft → committed → paid → closed)
 *   2. CheckItem      — line items on a check
 *   3. CheckEvent     — append-only audit trail
 *   4. ProcessedCommand — transactional idempotency (24h TTL)
 *   5. OrderNumberAllocator — monotonic order numbers per location/day
 *
 * Additive only. All DDL is guarded with tableExists / indexExists.
 */

const { tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[132-check-aggregate-models]'

  // ─── 1. Check table ─────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'Check'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "Check" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "tableId" TEXT,
        "orderType" TEXT NOT NULL DEFAULT 'dine_in',
        "employeeId" TEXT NOT NULL,
        "guestCount" INTEGER NOT NULL DEFAULT 1,
        "tabName" TEXT,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "orderNumber" INTEGER,
        "displayNumber" TEXT,
        "terminalId" TEXT,
        "leaseAcquiredAt" TIMESTAMP(3),
        "leaseLastHeartbeatAt" TIMESTAMP(3),
        "notes" TEXT,
        "orderId" TEXT,
        "isBottleService" BOOLEAN NOT NULL DEFAULT false,
        "bottleServiceTierId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "Check_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Check_orderId_key" UNIQUE ("orderId"),
        CONSTRAINT "Check_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created Check table`)
  } else {
    console.log(`${PREFIX} Check table already exists`)
  }

  // ─── 2. CheckItem table ─────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CheckItem'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CheckItem" (
        "id" TEXT NOT NULL,
        "checkId" TEXT NOT NULL,
        "menuItemId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "priceCents" INTEGER NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "modifiersJson" TEXT,
        "seatNumber" INTEGER,
        "courseNumber" INTEGER,
        "specialNotes" TEXT,
        "itemType" TEXT,
        "blockTimeMinutes" INTEGER,
        "isHeld" BOOLEAN NOT NULL DEFAULT false,
        "delayMinutes" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'active',
        "soldByWeight" BOOLEAN NOT NULL DEFAULT false,
        "weight" DOUBLE PRECISION,
        "weightUnit" TEXT,
        "unitPriceCents" INTEGER,
        "pricingOptionId" TEXT,
        "pricingOptionLabel" TEXT,
        "pourSize" TEXT,
        "pourMultiplier" DOUBLE PRECISION,
        "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
        "pizzaConfigJson" TEXT,
        "comboSelectionsJson" TEXT,
        "itemDiscountsJson" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CheckItem_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CheckItem_checkId_fkey"
          FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created CheckItem table`)
  } else {
    console.log(`${PREFIX} CheckItem table already exists`)
  }

  // ─── 3. CheckEvent table ────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CheckEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CheckEvent" (
        "id" TEXT NOT NULL,
        "eventId" TEXT NOT NULL,
        "checkId" TEXT NOT NULL,
        "serverSequence" SERIAL,
        "type" TEXT NOT NULL,
        "payloadJson" TEXT NOT NULL,
        "schemaVersion" INTEGER NOT NULL DEFAULT 1,
        "deviceId" TEXT,
        "deviceCounter" INTEGER,
        "commandId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CheckEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CheckEvent_eventId_key" UNIQUE ("eventId"),
        CONSTRAINT "CheckEvent_checkId_fkey"
          FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created CheckEvent table`)
  } else {
    console.log(`${PREFIX} CheckEvent table already exists`)
  }

  // ─── 4. ProcessedCommand table ──────────────────────────────────────────
  if (!(await tableExists(prisma, 'ProcessedCommand'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ProcessedCommand" (
        "id" TEXT NOT NULL,
        "commandId" TEXT NOT NULL,
        "resultJson" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProcessedCommand_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ProcessedCommand_commandId_key" UNIQUE ("commandId")
      )
    `)
    console.log(`${PREFIX} Created ProcessedCommand table`)
  } else {
    console.log(`${PREFIX} ProcessedCommand table already exists`)
  }

  // ─── 5. OrderNumberAllocator table ──────────────────────────────────────
  if (!(await tableExists(prisma, 'OrderNumberAllocator'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "OrderNumberAllocator" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "businessDate" TEXT NOT NULL,
        "nextNumber" INTEGER NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OrderNumberAllocator_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OrderNumberAllocator_locationId_businessDate_key" UNIQUE ("locationId", "businessDate")
      )
    `)
    console.log(`${PREFIX} Created OrderNumberAllocator table`)
  } else {
    console.log(`${PREFIX} OrderNumberAllocator table already exists`)
  }

  // ─── 6. Indexes ─────────────────────────────────────────────────────────
  const idxSpecs = [
    // Check indexes
    {
      name: 'Check_locationId_status_idx',
      sql: `CREATE INDEX "Check_locationId_status_idx" ON "Check"("locationId", "status")`,
    },
    {
      name: 'Check_locationId_tableId_idx',
      sql: `CREATE INDEX "Check_locationId_tableId_idx" ON "Check"("locationId", "tableId")`,
    },
    {
      name: 'Check_locationId_status_createdAt_idx',
      sql: `CREATE INDEX "Check_locationId_status_createdAt_idx" ON "Check"("locationId", "status", "createdAt")`,
    },
    {
      name: 'Check_orderId_idx',
      sql: `CREATE INDEX "Check_orderId_idx" ON "Check"("orderId")`,
    },
    // CheckItem indexes
    {
      name: 'CheckItem_checkId_idx',
      sql: `CREATE INDEX "CheckItem_checkId_idx" ON "CheckItem"("checkId")`,
    },
    {
      name: 'CheckItem_checkId_status_idx',
      sql: `CREATE INDEX "CheckItem_checkId_status_idx" ON "CheckItem"("checkId", "status")`,
    },
    // CheckEvent indexes
    {
      name: 'CheckEvent_checkId_idx',
      sql: `CREATE INDEX "CheckEvent_checkId_idx" ON "CheckEvent"("checkId")`,
    },
    {
      name: 'CheckEvent_checkId_serverSequence_idx',
      sql: `CREATE INDEX "CheckEvent_checkId_serverSequence_idx" ON "CheckEvent"("checkId", "serverSequence")`,
    },
    {
      name: 'CheckEvent_commandId_idx',
      sql: `CREATE INDEX "CheckEvent_commandId_idx" ON "CheckEvent"("commandId")`,
    },
    // ProcessedCommand indexes
    {
      name: 'ProcessedCommand_commandId_idx',
      sql: `CREATE INDEX "ProcessedCommand_commandId_idx" ON "ProcessedCommand"("commandId")`,
    },
    {
      name: 'ProcessedCommand_createdAt_idx',
      sql: `CREATE INDEX "ProcessedCommand_createdAt_idx" ON "ProcessedCommand"("createdAt")`,
    },
    // OrderNumberAllocator indexes
    {
      name: 'OrderNumberAllocator_locationId_businessDate_idx',
      sql: `CREATE INDEX "OrderNumberAllocator_locationId_businessDate_idx" ON "OrderNumberAllocator"("locationId", "businessDate")`,
    },
  ]

  for (const idx of idxSpecs) {
    if (!(await indexExists(prisma, idx.name))) {
      await prisma.$executeRawUnsafe(idx.sql)
      console.log(`${PREFIX} Created index ${idx.name}`)
    }
  }

  console.log(`${PREFIX} Migration complete`)
}

module.exports = { up }
