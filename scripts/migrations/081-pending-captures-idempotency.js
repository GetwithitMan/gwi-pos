const { tableExists, columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[081-pending-captures-idempotency]'

  const exists = await tableExists(prisma, '_pending_captures')
  if (!exists) {
    console.log(`${PREFIX} _pending_captures table does not exist — skipping`)
    return
  }

  // Add idempotencyKey column for lock-and-check double-charge prevention
  const hasIdempKey = await columnExists(prisma, '_pending_captures', 'idempotencyKey')
  if (!hasIdempKey) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "_pending_captures" ADD COLUMN "idempotencyKey" TEXT`)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "idx_pending_captures_idempotency" ON "_pending_captures" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`)
    console.log(`${PREFIX} Added idempotencyKey column + unique index`)
  }

  // Add response_json column for caching completed payment responses
  const hasResponseJson = await columnExists(prisma, '_pending_captures', 'response_json')
  if (!hasResponseJson) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "_pending_captures" ADD COLUMN "response_json" TEXT`)
    console.log(`${PREFIX} Added response_json column`)
  }
}

module.exports = { up }
