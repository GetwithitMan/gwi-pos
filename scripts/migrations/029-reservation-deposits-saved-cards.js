/**
 * Migration 029: Reservation Deposits + Saved Cards (Card on File)
 *
 * Creates:
 * - ReservationDeposit — tracks deposit payments/refunds per reservation
 * - SavedCard — tokenized card storage per customer (card-on-file foundation)
 */

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
    LIMIT 1
  `, table, column)
  return rows.length > 0
}

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = $1
    LIMIT 1
  `, table)
  return rows.length > 0
}

module.exports.up = async function up(prisma) {
  // ── ReservationDeposit table ──────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ReservationDeposit'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ReservationDeposit" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"      TEXT NOT NULL,
        "reservationId"   TEXT NOT NULL,

        -- Payment details
        "type"            TEXT NOT NULL DEFAULT 'deposit',
        "amount"          DECIMAL(10,2) NOT NULL,
        "paymentMethod"   TEXT NOT NULL DEFAULT 'card',
        "cardLast4"       TEXT,
        "cardBrand"       TEXT,
        "datacapRecordNo" TEXT,
        "datacapRefNumber" TEXT,
        "status"          TEXT NOT NULL DEFAULT 'completed',

        -- Refund tracking
        "refundedAmount"  DECIMAL(10,2) NOT NULL DEFAULT 0,
        "refundedAt"      TIMESTAMP(3),
        "refundReason"    TEXT,

        -- Attribution
        "employeeId"      TEXT,
        "notes"           TEXT,

        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"       TIMESTAMP(3),
        "syncedAt"        TIMESTAMP(3),

        CONSTRAINT "ReservationDeposit_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ReservationDeposit_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "ReservationDeposit_reservationId_fkey"
          FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDeposit_locationId_idx" ON "ReservationDeposit" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDeposit_reservationId_idx" ON "ReservationDeposit" ("reservationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ReservationDeposit_locationId_createdAt_idx" ON "ReservationDeposit" ("locationId", "createdAt")`)
    console.log('[029] Created ReservationDeposit table')
  }

  // ── Add depositRequired / depositAmount to Reservation ────────────────────
  if (!(await columnExists(prisma, 'Reservation', 'depositRequired'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Reservation" ADD COLUMN "depositRequired" BOOLEAN NOT NULL DEFAULT false`)
    console.log('[029] Added Reservation.depositRequired')
  }
  if (!(await columnExists(prisma, 'Reservation', 'depositAmount'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Reservation" ADD COLUMN "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0`)
    console.log('[029] Added Reservation.depositAmount')
  }

  // ── SavedCard table ───────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'SavedCard'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "SavedCard" (
        "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"    TEXT NOT NULL,
        "customerId"    TEXT NOT NULL,

        -- Card identity (NEVER store full PAN)
        "token"         TEXT NOT NULL,
        "last4"         TEXT NOT NULL,
        "cardBrand"     TEXT NOT NULL,
        "expiryMonth"   TEXT,
        "expiryYear"    TEXT,

        -- Display
        "nickname"      TEXT,
        "isDefault"     BOOLEAN NOT NULL DEFAULT false,

        -- Consent tracking
        "consentRecordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "consentMethod"     TEXT NOT NULL DEFAULT 'in_person',

        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"     TIMESTAMP(3),
        "syncedAt"      TIMESTAMP(3),

        CONSTRAINT "SavedCard_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "SavedCard_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "SavedCard_customerId_fkey"
          FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "SavedCard_locationId_idx" ON "SavedCard" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "SavedCard_customerId_idx" ON "SavedCard" ("customerId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "SavedCard_locationId_customerId_idx" ON "SavedCard" ("locationId", "customerId")`)
    console.log('[029] Created SavedCard table')
  }
}
