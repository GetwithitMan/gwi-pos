// Migration 036: Add overtime pricing fields to MenuItem
// Supports multiplier, custom rate, flat fee, and per-minute overtime modes.

async function columnExists(prisma, table, column) {
  const result = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table,
    column
  )
  return result.length > 0
}

async function up(prisma) {
  const cols = [
    { name: 'overtimeEnabled', sql: `ALTER TABLE "MenuItem" ADD COLUMN "overtimeEnabled" BOOLEAN DEFAULT false` },
    { name: 'overtimeMode', sql: `ALTER TABLE "MenuItem" ADD COLUMN "overtimeMode" TEXT` },
    { name: 'overtimeMultiplier', sql: `ALTER TABLE "MenuItem" ADD COLUMN "overtimeMultiplier" DECIMAL` },
    { name: 'overtimePerMinuteRate', sql: `ALTER TABLE "MenuItem" ADD COLUMN "overtimePerMinuteRate" DECIMAL` },
    { name: 'overtimeFlatFee', sql: `ALTER TABLE "MenuItem" ADD COLUMN "overtimeFlatFee" DECIMAL` },
    { name: 'overtimeGraceMinutes', sql: `ALTER TABLE "MenuItem" ADD COLUMN "overtimeGraceMinutes" INTEGER DEFAULT 5` },
  ]

  for (const col of cols) {
    if (!(await columnExists(prisma, 'MenuItem', col.name))) {
      await prisma.$executeRawUnsafe(col.sql)
      console.log(`  Added MenuItem.${col.name}`)
    }
  }
}

module.exports = { up }
