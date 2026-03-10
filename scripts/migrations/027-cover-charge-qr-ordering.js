const { tableExists, columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[027-cover-charge-qr-ordering]'

  // ── CoverCharge table ───────────────────────────────────────────────────────
  const hasCoverCharge = await tableExists(prisma, 'CoverCharge')
  if (!hasCoverCharge) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CoverCharge" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"      TEXT NOT NULL,
        "employeeId"      TEXT NOT NULL,
        "amount"          DECIMAL(10,2) NOT NULL DEFAULT 0,
        "paymentMethod"   TEXT NOT NULL DEFAULT 'cash',
        "guestCount"      INTEGER NOT NULL DEFAULT 1,
        "notes"           TEXT,
        "isVip"           BOOLEAN NOT NULL DEFAULT false,
        "isComped"        BOOLEAN NOT NULL DEFAULT false,
        "compReason"      TEXT,
        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"       TIMESTAMP(3),
        CONSTRAINT "CoverCharge_pkey" PRIMARY KEY ("id")
      )
    `)
    console.log(`${PREFIX} Created CoverCharge table`)

    // Indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX "CoverCharge_locationId_idx" ON "CoverCharge" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CoverCharge_locationId_createdAt_idx" ON "CoverCharge" ("locationId", "createdAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CoverCharge_employeeId_idx" ON "CoverCharge" ("employeeId")`)
    console.log(`${PREFIX} Created CoverCharge indexes`)
  } else {
    console.log(`${PREFIX} CoverCharge table already exists — skipping`)
  }

  // ── qrOrderCode column on Table ─────────────────────────────────────────────
  const hasQrCode = await columnExists(prisma, 'Table', 'qrOrderCode')
  if (!hasQrCode) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Table" ADD COLUMN "qrOrderCode" TEXT`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Table_qrOrderCode_key" ON "Table" ("qrOrderCode") WHERE "qrOrderCode" IS NOT NULL`)
    console.log(`${PREFIX} Added qrOrderCode column to Table`)
  } else {
    console.log(`${PREFIX} Table.qrOrderCode already exists — skipping`)
  }
}

module.exports = { up }
