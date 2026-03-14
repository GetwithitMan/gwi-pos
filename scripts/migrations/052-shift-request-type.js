const { columnExists, enumValueExists } = require('../migration-helpers')

async function up(prisma) {
  // 1. Create the ShiftRequestType enum if it doesn't exist
  const enumExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = 'ShiftRequestType' LIMIT 1`
  )
  if (enumExists.length === 0) {
    await prisma.$executeRawUnsafe(
      `CREATE TYPE "ShiftRequestType" AS ENUM ('swap', 'cover', 'drop')`
    )
  } else {
    // Ensure all values exist
    for (const val of ['swap', 'cover', 'drop']) {
      const exists = await enumValueExists(prisma, 'ShiftRequestType', val)
      if (!exists) {
        await prisma.$executeRawUnsafe(
          `ALTER TYPE "ShiftRequestType" ADD VALUE IF NOT EXISTS '${val}'`
        )
      }
    }
  }

  // 2. Add 'type' column to ShiftSwapRequest (default 'swap' for existing rows)
  const hasType = await columnExists(prisma, 'ShiftSwapRequest', 'type')
  if (!hasType) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ShiftSwapRequest" ADD COLUMN "type" "ShiftRequestType" NOT NULL DEFAULT 'swap'`
    )
  }

  // 3. Add 'reason' column (employee's reason for requesting)
  const hasReason = await columnExists(prisma, 'ShiftSwapRequest', 'reason')
  if (!hasReason) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ShiftSwapRequest" ADD COLUMN "reason" TEXT`
    )
  }

  // 4. Add 'managerNote' column (manager's note on approval/denial)
  const hasManagerNote = await columnExists(prisma, 'ShiftSwapRequest', 'managerNote')
  if (!hasManagerNote) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ShiftSwapRequest" ADD COLUMN "managerNote" TEXT`
    )
  }

  // 5. Add index on type column
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ShiftSwapRequest_type_idx" ON "ShiftSwapRequest" ("type")`
  )
}

module.exports = { up }
