/**
 * Migration 091 — Add missing sync columns to upstream/bidirectional models
 *
 * 13 models were registered in sync-config.ts but silently skipped by the
 * upstream sync worker because they lacked required columns:
 *
 * - 9 models missing `syncedAt` (worker requires both updatedAt + syncedAt)
 * - 2 models missing both `syncedAt` + `updatedAt`
 * - 1 model missing `updatedAt` only
 * - 1 downstream model missing `updatedAt` + `syncedAt`
 * - 3 bidirectional models missing `lastMutatedBy` (conflict detection broken)
 */

async function up(prisma) {
  // ── syncedAt additions (9 models) ────────────────────────────────────
  const needsSyncedAt = [
    'EmployeePermissionOverride',
    'InventoryCountEntry',
    'MarginEdgeProductMapping',
    'PendingDeduction',
    'ReservationBlock',
    'SevenShiftsDailySalesPush',
    'VendorOrder',
    'VendorOrderLineItem',
    'WasteLog',
  ]

  for (const table of needsSyncedAt) {
    const cols = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'syncedAt'`,
      table
    )
    if (cols.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "syncedAt" TIMESTAMPTZ`)
    }
  }

  // ── syncedAt + updatedAt additions (2 models) ────────────────────────
  const needsBoth = ['BergDispenseEvent', 'IngredientCostHistory']

  for (const table of needsBoth) {
    const syncedAtCols = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'syncedAt'`,
      table
    )
    if (syncedAtCols.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "syncedAt" TIMESTAMPTZ`)
    }

    const updatedAtCols = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'updatedAt'`,
      table
    )
    if (updatedAtCols.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
    }
  }

  // ── updatedAt only (DigitalReceipt) ──────────────────────────────────
  const drCols = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'DigitalReceipt' AND column_name = 'updatedAt'`
  )
  if (drCols.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "DigitalReceipt" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  }

  // ── ReasonAccess: updatedAt + syncedAt ───────────────────────────────
  const raCols1 = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ReasonAccess' AND column_name = 'updatedAt'`
  )
  if (raCols1.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ReasonAccess" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  }
  const raCols2 = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ReasonAccess' AND column_name = 'syncedAt'`
  )
  if (raCols2.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ReasonAccess" ADD COLUMN "syncedAt" TIMESTAMPTZ`)
  }

  // ── lastMutatedBy additions (3 bidirectional models) ─────────────────
  const needsLastMutatedBy = ['BottleProduct', 'SpiritCategory', 'SpiritModifierGroup']

  for (const table of needsLastMutatedBy) {
    const cols = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'lastMutatedBy'`,
      table
    )
    if (cols.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "lastMutatedBy" TEXT`)
    }
  }
}

module.exports = { up }
