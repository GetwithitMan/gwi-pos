// Migration 035: Add deposit fields to EntertainmentWaitlist
// Supports cash and card (pre-auth) deposits for entertainment waitlist positions.

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
    { name: 'depositAmount', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositAmount" DECIMAL` },
    { name: 'depositMethod', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositMethod" TEXT` },
    { name: 'depositRecordNo', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositRecordNo" TEXT` },
    { name: 'depositCardLast4', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositCardLast4" TEXT` },
    { name: 'depositCardBrand', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositCardBrand" TEXT` },
    { name: 'depositStatus', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositStatus" TEXT` },
    { name: 'depositCollectedBy', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositCollectedBy" TEXT` },
    { name: 'depositRefundedAt', sql: `ALTER TABLE "EntertainmentWaitlist" ADD COLUMN "depositRefundedAt" TIMESTAMPTZ` },
  ]

  for (const col of cols) {
    if (!(await columnExists(prisma, 'EntertainmentWaitlist', col.name))) {
      await prisma.$executeRawUnsafe(col.sql)
      console.log(`  Added EntertainmentWaitlist.${col.name}`)
    }
  }
}

module.exports = { up }
