/**
 * Migration 106 — Add lastMutatedBy to LoyaltyProgram + LoyaltyTier
 *
 * These tables are bidirectional in sync-config (MC creates, NUC consumes).
 * The downstream sync worker filters bidirectional models by
 * `WHERE "lastMutatedBy" = 'cloud'`, so without this column the sync
 * queries fail with "column lastMutatedBy does not exist".
 *
 * Also ensures the tables exist (safety net for NUCs that deployed before
 * migration 100 ran).
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[106]'

  // ── Safety net: ensure LoyaltyProgram table exists ────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyProgram'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyProgram" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL,
        "name" TEXT NOT NULL DEFAULT 'Loyalty Program',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "pointsPerDollar" INTEGER NOT NULL DEFAULT 1,
        "pointValueCents" INTEGER NOT NULL DEFAULT 1,
        "minimumRedeemPoints" INTEGER NOT NULL DEFAULT 100,
        "roundingMode" TEXT NOT NULL DEFAULT 'floor',
        "excludedCategoryIds" TEXT[] DEFAULT '{}',
        "excludedItemTypes" TEXT[] DEFAULT '{}',
        "lastMutatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMPTZ,
        CONSTRAINT "LoyaltyProgram_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)
    console.log(`${PREFIX} Created LoyaltyProgram table (with lastMutatedBy)`)

    // Indexes
    if (!(await indexExists(prisma, 'LoyaltyProgram_locationId_idx'))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyProgram_locationId_idx" ON "LoyaltyProgram" ("locationId")`)
    }
    if (!(await indexExists(prisma, 'LoyaltyProgram_locationId_isActive_idx'))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyProgram_locationId_isActive_idx" ON "LoyaltyProgram" ("locationId", "isActive") WHERE "isActive" = true`)
    }
  } else {
    console.log(`${PREFIX} LoyaltyProgram table exists`)
  }

  // ── Safety net: ensure LoyaltyTier table exists ───────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyTier'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyTier" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "programId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "minimumPoints" INTEGER NOT NULL DEFAULT 0,
        "pointsMultiplier" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
        "perks" JSONB DEFAULT '{}',
        "color" TEXT NOT NULL DEFAULT '#6366f1',
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "lastMutatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMPTZ,
        CONSTRAINT "LoyaltyTier_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE
      )
    `)
    console.log(`${PREFIX} Created LoyaltyTier table (with lastMutatedBy)`)

    // Indexes
    if (!(await indexExists(prisma, 'LoyaltyTier_programId_idx'))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTier_programId_idx" ON "LoyaltyTier" ("programId")`)
    }
    if (!(await indexExists(prisma, 'LoyaltyTier_programId_sortOrder_idx'))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTier_programId_sortOrder_idx" ON "LoyaltyTier" ("programId", "sortOrder")`)
    }
  } else {
    console.log(`${PREFIX} LoyaltyTier table exists`)
  }

  // ── Safety net: ensure LoyaltyTransaction table exists ────────────────────
  if (!(await tableExists(prisma, 'LoyaltyTransaction'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyTransaction" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "customerId" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderId" TEXT,
        "type" TEXT NOT NULL,
        "points" INTEGER NOT NULL,
        "balanceBefore" INTEGER NOT NULL DEFAULT 0,
        "balanceAfter" INTEGER NOT NULL DEFAULT 0,
        "description" TEXT NOT NULL DEFAULT '',
        "employeeId" TEXT,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "syncedAt" TIMESTAMPTZ,
        CONSTRAINT "LoyaltyTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL
      )
    `)
    console.log(`${PREFIX} Created LoyaltyTransaction table`)

    // Indexes
    const txIndexes = [
      ['LoyaltyTransaction_customerId_idx', '"customerId"'],
      ['LoyaltyTransaction_locationId_idx', '"locationId"'],
      ['LoyaltyTransaction_type_idx', '"type"'],
      ['LoyaltyTransaction_createdAt_idx', '"createdAt"'],
    ]
    for (const [name, cols] of txIndexes) {
      if (!(await indexExists(prisma, name))) {
        await prisma.$executeRawUnsafe(`CREATE INDEX "${name}" ON "LoyaltyTransaction" (${cols})`)
      }
    }
    if (!(await indexExists(prisma, 'LoyaltyTransaction_orderId_idx'))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_orderId_idx" ON "LoyaltyTransaction" ("orderId") WHERE "orderId" IS NOT NULL`)
    }
    if (!(await indexExists(prisma, 'LoyaltyTransaction_customerId_createdAt_idx'))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_customerId_createdAt_idx" ON "LoyaltyTransaction" ("customerId", "createdAt" DESC)`)
    }
  }

  // ── Ensure Customer loyalty FK columns exist ──────────────────────────────
  if (!(await columnExists(prisma, 'Customer', 'loyaltyTierId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "loyaltyTierId" TEXT`)
    console.log(`${PREFIX} Added Customer.loyaltyTierId`)
  }
  if (!(await columnExists(prisma, 'Customer', 'lifetimePoints'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "lifetimePoints" INTEGER NOT NULL DEFAULT 0`)
    console.log(`${PREFIX} Added Customer.lifetimePoints`)
  }
  if (!(await columnExists(prisma, 'Customer', 'loyaltyEnrolledAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "loyaltyEnrolledAt" TIMESTAMP(3)`)
    console.log(`${PREFIX} Added Customer.loyaltyEnrolledAt`)
  }
  if (!(await columnExists(prisma, 'Customer', 'loyaltyProgramId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "loyaltyProgramId" TEXT`)
    console.log(`${PREFIX} Added Customer.loyaltyProgramId`)
  }

  // Customer FK constraints (safe: try/catch for already-exists)
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Customer" ADD CONSTRAINT "Customer_loyaltyTierId_fkey"
      FOREIGN KEY ("loyaltyTierId") REFERENCES "LoyaltyTier"("id") ON DELETE SET NULL
    `)
  } catch { /* already exists */ }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Customer" ADD CONSTRAINT "Customer_loyaltyProgramId_fkey"
      FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL
    `)
  } catch { /* already exists */ }

  // ── Add lastMutatedBy to existing tables (if tables existed but column missing) ──
  if (!(await columnExists(prisma, 'LoyaltyProgram', 'lastMutatedBy'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoyaltyProgram" ADD COLUMN "lastMutatedBy" TEXT`)
    console.log(`${PREFIX} Added LoyaltyProgram.lastMutatedBy`)
  } else {
    console.log(`${PREFIX} LoyaltyProgram.lastMutatedBy already exists`)
  }

  if (!(await columnExists(prisma, 'LoyaltyTier', 'lastMutatedBy'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "LoyaltyTier" ADD COLUMN "lastMutatedBy" TEXT`)
    console.log(`${PREFIX} Added LoyaltyTier.lastMutatedBy`)
  } else {
    console.log(`${PREFIX} LoyaltyTier.lastMutatedBy already exists`)
  }

  console.log(`${PREFIX} Done — loyalty tables verified + lastMutatedBy added`)
}
