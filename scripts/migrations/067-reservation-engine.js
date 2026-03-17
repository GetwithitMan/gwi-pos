/**
 * Migration 067 — Reservation Engine Foundation
 *
 * Adds enum values: pending, checked_in to ReservationStatus
 * Alters: Reservation (22 new columns), Table (6 new columns), Customer (3 new columns)
 * Creates: ReservationBlock, ReservationTable, ReservationEvent,
 *          ReservationIdempotencyKey, ReservationDepositToken, ReservationDeposit
 */

const { tableExists, columnExists, enumValueExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-067]'

  // ─── 1. Enum values ─────────────────────────────────────────────────────────
  if (!(await enumValueExists(prisma, 'ReservationStatus', 'pending'))) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'confirmed'`)
    console.log(`${PREFIX} Added 'pending' to ReservationStatus`)
  }
  if (!(await enumValueExists(prisma, 'ReservationStatus', 'checked_in'))) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'checked_in' BEFORE 'seated'`)
    console.log(`${PREFIX} Added 'checked_in' to ReservationStatus`)
  }

  // ─── 2. ALTER Reservation — new columns ─────────────────────────────────────
  const reservationColumns = [
    { name: 'occasion', sql: '"occasion" TEXT' },
    { name: 'dietaryRestrictions', sql: '"dietaryRestrictions" TEXT' },
    { name: 'source', sql: '"source" TEXT DEFAULT \'staff\'' },
    { name: 'externalId', sql: '"externalId" TEXT' },
    { name: 'sectionPreference', sql: '"sectionPreference" TEXT' },
    { name: 'confirmationSentAt', sql: '"confirmationSentAt" TIMESTAMP(3)' },
    { name: 'reminder24hSentAt', sql: '"reminder24hSentAt" TIMESTAMP(3)' },
    { name: 'reminder2hSentAt', sql: '"reminder2hSentAt" TIMESTAMP(3)' },
    { name: 'thankYouSentAt', sql: '"thankYouSentAt" TIMESTAMP(3)' },
    { name: 'confirmedAt', sql: '"confirmedAt" TIMESTAMP(3)' },
    { name: 'checkedInAt', sql: '"checkedInAt" TIMESTAMP(3)' },
    { name: 'manageToken', sql: '"manageToken" TEXT' },
    { name: 'tags', sql: '"tags" JSONB NOT NULL DEFAULT \'[]\'' },
    { name: 'serviceDate', sql: '"serviceDate" DATE' },
    { name: 'holdExpiresAt', sql: '"holdExpiresAt" TIMESTAMP(3)' },
    { name: 'depositStatus', sql: '"depositStatus" TEXT DEFAULT \'not_required\'' },
    { name: 'depositAmountCents', sql: '"depositAmountCents" INTEGER' },
    { name: 'depositRulesSnapshot', sql: '"depositRulesSnapshot" JSONB' },
    { name: 'statusUpdatedAt', sql: '"statusUpdatedAt" TIMESTAMP(3)' },
    { name: 'sourceMetadata', sql: '"sourceMetadata" JSONB' },
    { name: 'smsOptInSnapshot', sql: '"smsOptInSnapshot" BOOLEAN' },
    { name: 'depositRequired', sql: '"depositRequired" BOOLEAN' },
    { name: 'depositAmount', sql: '"depositAmount" DECIMAL(10,2)' },
  ]

  for (const col of reservationColumns) {
    if (!(await columnExists(prisma, 'Reservation', col.name))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Reservation" ADD COLUMN ${col.sql}`)
      console.log(`${PREFIX} Added Reservation.${col.name}`)
    }
  }

  // Reservation indexes
  if (!(await indexExists(prisma, 'Reservation_manageToken_key'))) {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Reservation_manageToken_key" ON "Reservation" ("manageToken") WHERE "manageToken" IS NOT NULL`)
    console.log(`${PREFIX} Created Reservation_manageToken_key unique index`)
  }
  if (!(await indexExists(prisma, 'Reservation_source_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Reservation_source_idx" ON "Reservation" ("source")`)
    console.log(`${PREFIX} Created Reservation_source_idx`)
  }
  if (!(await indexExists(prisma, 'Reservation_locationId_serviceDate_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Reservation_locationId_serviceDate_idx" ON "Reservation" ("locationId", "serviceDate")`)
    console.log(`${PREFIX} Created Reservation_locationId_serviceDate_idx`)
  }
  if (!(await indexExists(prisma, 'Reservation_holdExpiresAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Reservation_holdExpiresAt_idx" ON "Reservation" ("holdExpiresAt")`)
    console.log(`${PREFIX} Created Reservation_holdExpiresAt_idx`)
  }
  if (!(await indexExists(prisma, 'Reservation_locationId_source_externalId_key'))) {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Reservation_locationId_source_externalId_key" ON "Reservation" ("locationId", "source", "externalId") WHERE "externalId" IS NOT NULL`)
    console.log(`${PREFIX} Created Reservation_locationId_source_externalId_key`)
  }

  // ─── 3. ALTER Table — new columns ──────────────────────────────────────────
  const tableColumns = [
    { name: 'minCapacity', sql: '"minCapacity" INTEGER NOT NULL DEFAULT 1' },
    { name: 'maxCapacity', sql: '"maxCapacity" INTEGER' },
    { name: 'isReservable', sql: '"isReservable" BOOLEAN NOT NULL DEFAULT true' },
    { name: 'combinableWithTableIds', sql: '"combinableWithTableIds" JSONB NOT NULL DEFAULT \'[]\'' },
    { name: 'turnTimeOverrideMinutes', sql: '"turnTimeOverrideMinutes" INTEGER' },
    { name: 'priority', sql: '"priority" INTEGER NOT NULL DEFAULT 0' },
  ]

  for (const col of tableColumns) {
    if (!(await columnExists(prisma, 'Table', col.name))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Table" ADD COLUMN ${col.sql}`)
      console.log(`${PREFIX} Added Table.${col.name}`)
    }
  }

  // Backfill maxCapacity from capacity where not already set
  await prisma.$executeRawUnsafe(`UPDATE "Table" SET "maxCapacity" = "capacity" WHERE "maxCapacity" IS NULL`)
  console.log(`${PREFIX} Backfilled Table.maxCapacity from capacity`)

  // ─── 4. ALTER Customer — new columns ───────────────────────────────────────
  const customerColumns = [
    { name: 'noShowCount', sql: '"noShowCount" INTEGER NOT NULL DEFAULT 0' },
    { name: 'isBlacklisted', sql: '"isBlacklisted" BOOLEAN NOT NULL DEFAULT false' },
    { name: 'blacklistOverrideUntil', sql: '"blacklistOverrideUntil" DATE' },
  ]

  for (const col of customerColumns) {
    if (!(await columnExists(prisma, 'Customer', col.name))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN ${col.sql}`)
      console.log(`${PREFIX} Added Customer.${col.name}`)
    }
  }

  // ─── 5. ReservationBlock ───────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationBlock'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationBlock" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL REFERENCES "Location"("id"),
        "name" TEXT NOT NULL,
        "reason" TEXT,
        "blockDate" DATE NOT NULL,
        "startTime" TEXT,
        "endTime" TEXT,
        "isAllDay" BOOLEAN NOT NULL DEFAULT false,
        "reducedCapacityPercent" INTEGER CHECK ("reducedCapacityPercent" IS NULL OR ("reducedCapacityPercent" >= 0 AND "reducedCapacityPercent" <= 100)),
        "blockedTableIds" JSONB NOT NULL DEFAULT '[]',
        "blockedSectionIds" JSONB NOT NULL DEFAULT '[]',
        "createdBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationBlock_locationId_blockDate_idx" ON "ReservationBlock" ("locationId", "blockDate")`)
    console.log(`${PREFIX} Created ReservationBlock table + index`)
  } else {
    console.log(`${PREFIX} ReservationBlock table already exists`)
  }

  // ─── 6. ReservationTable ───────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationTable'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationTable" (
        "reservationId" TEXT NOT NULL REFERENCES "Reservation"("id") ON DELETE CASCADE,
        "tableId" TEXT NOT NULL REFERENCES "Table"("id") ON DELETE CASCADE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("reservationId", "tableId")
      )
    `)
    console.log(`${PREFIX} Created ReservationTable table`)
  } else {
    console.log(`${PREFIX} ReservationTable table already exists`)
  }

  // ─── 7. ReservationEvent ───────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationEvent" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL,
        "reservationId" TEXT REFERENCES "Reservation"("id"),
        "eventType" TEXT NOT NULL,
        "actor" TEXT NOT NULL,
        "actorId" TEXT,
        "details" JSONB NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationEvent_reservationId_idx" ON "ReservationEvent" ("reservationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationEvent_locationId_createdAt_idx" ON "ReservationEvent" ("locationId", "createdAt")`)
    console.log(`${PREFIX} Created ReservationEvent table + indexes`)
  } else {
    console.log(`${PREFIX} ReservationEvent table already exists`)
  }

  // ─── 8. ReservationIdempotencyKey ──────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationIdempotencyKey'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationIdempotencyKey" (
        "key" TEXT PRIMARY KEY,
        "reservationId" TEXT NOT NULL REFERENCES "Reservation"("id"),
        "source" TEXT NOT NULL DEFAULT 'booking',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationIdempotencyKey_reservationId_idx" ON "ReservationIdempotencyKey" ("reservationId")`)
    console.log(`${PREFIX} Created ReservationIdempotencyKey table + index`)
  } else {
    console.log(`${PREFIX} ReservationIdempotencyKey table already exists`)
  }

  // ─── 9. ReservationDepositToken ────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationDepositToken'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationDepositToken" (
        "token" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "reservationId" TEXT NOT NULL REFERENCES "Reservation"("id"),
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "usedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDepositToken_reservationId_idx" ON "ReservationDepositToken" ("reservationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDepositToken_expiresAt_idx" ON "ReservationDepositToken" ("expiresAt")`)
    console.log(`${PREFIX} Created ReservationDepositToken table + indexes`)
  } else {
    console.log(`${PREFIX} ReservationDepositToken table already exists`)
  }

  // ─── 10. ReservationDeposit ────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationDeposit'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationDeposit" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "locationId" TEXT NOT NULL REFERENCES "Location"("id"),
        "reservationId" TEXT NOT NULL REFERENCES "Reservation"("id"),
        "type" TEXT NOT NULL DEFAULT 'deposit',
        "amount" DECIMAL(10,2) NOT NULL,
        "paymentMethod" TEXT NOT NULL,
        "cardLast4" TEXT,
        "cardBrand" TEXT,
        "datacapRecordNo" TEXT,
        "datacapRefNumber" TEXT,
        "status" TEXT NOT NULL DEFAULT 'completed' CHECK ("status" IN ('completed', 'refunded', 'partial_refund', 'failed', 'pending')),
        "refundedAmount" DECIMAL(10,2),
        "refundedAt" TIMESTAMP(3),
        "refundReason" TEXT,
        "employeeId" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3)
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDeposit_locationId_idx" ON "ReservationDeposit" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDeposit_reservationId_idx" ON "ReservationDeposit" ("reservationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDeposit_locationId_createdAt_idx" ON "ReservationDeposit" ("locationId", "createdAt")`)
    console.log(`${PREFIX} Created ReservationDeposit table + indexes`)
  } else {
    console.log(`${PREFIX} ReservationDeposit table already exists`)
  }

  // ─── 11. Check constraints on Reservation ──────────────────────────────────
  // depositAmountCents must be >= 0 when set
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_depositAmountCents_check"
      CHECK ("depositAmountCents" IS NULL OR "depositAmountCents" >= 0)
    `)
    console.log(`${PREFIX} Added Reservation_depositAmountCents_check`)
  } catch {
    console.log(`${PREFIX} Reservation_depositAmountCents_check already exists`)
  }

  // depositStatus must be a valid value
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_depositStatus_check"
      CHECK ("depositStatus" IS NULL OR "depositStatus" IN ('not_required', 'required', 'paid', 'refunded', 'partial_refund', 'forfeited'))
    `)
    console.log(`${PREFIX} Added Reservation_depositStatus_check`)
  } catch {
    console.log(`${PREFIX} Reservation_depositStatus_check already exists`)
  }

  // source must be a known value
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_source_check"
      CHECK ("source" IS NULL OR "source" IN ('staff', 'online', 'phone', 'walkin', 'import', 'api'))
    `)
    console.log(`${PREFIX} Added Reservation_source_check`)
  } catch {
    console.log(`${PREFIX} Reservation_source_check already exists`)
  }

  // Table check constraints
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Table" ADD CONSTRAINT "Table_minCapacity_check"
      CHECK ("minCapacity" >= 1)
    `)
    console.log(`${PREFIX} Added Table_minCapacity_check`)
  } catch {
    console.log(`${PREFIX} Table_minCapacity_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Table" ADD CONSTRAINT "Table_maxCapacity_check"
      CHECK ("maxCapacity" IS NULL OR "maxCapacity" >= "minCapacity")
    `)
    console.log(`${PREFIX} Added Table_maxCapacity_check`)
  } catch {
    console.log(`${PREFIX} Table_maxCapacity_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Table" ADD CONSTRAINT "Table_priority_check"
      CHECK ("priority" >= 0)
    `)
    console.log(`${PREFIX} Added Table_priority_check`)
  } catch {
    console.log(`${PREFIX} Table_priority_check already exists`)
  }

  console.log(`${PREFIX} ✓ Migration 067 complete`)
}
