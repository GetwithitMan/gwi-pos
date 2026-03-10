const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[023-pending-captures]'

  const exists = await tableExists(prisma, '_pending_captures')
  if (exists) {
    console.log(`${PREFIX} _pending_captures table already exists — skipping`)
    return
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "_pending_captures" (
      "id"            TEXT PRIMARY KEY,
      "orderId"       TEXT NOT NULL,
      "locationId"    TEXT NOT NULL,
      "cardRecordNo"  TEXT NOT NULL,
      "cardLast4"     TEXT,
      "purchaseAmount" DECIMAL(10,2) NOT NULL,
      "tipAmount"     DECIMAL(10,2) NOT NULL DEFAULT 0,
      "totalAmount"   DECIMAL(10,2) NOT NULL,
      "authCode"      TEXT,
      "status"        TEXT NOT NULL DEFAULT 'pending',
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "completedAt"   TIMESTAMPTZ,
      "errorMessage"  TEXT
    )
  `)
  console.log(`${PREFIX} Created _pending_captures table`)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "idx_pending_captures_order" ON "_pending_captures" ("orderId")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX "idx_pending_captures_status" ON "_pending_captures" ("status", "createdAt")
  `)
  console.log(`${PREFIX} Created indexes on _pending_captures`)
}

module.exports = { up }
