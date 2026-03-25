/**
 * Migration 104 — Add (id, version) index to Order
 *
 * Order.version column already exists (default 1).
 * This index supports fast optimistic concurrency checks for
 * passive card detection actions (open-tab, save-card).
 */

const { indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[104]'

  if (!(await indexExists(prisma, 'Order_id_version_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Order_id_version_idx" ON "Order" ("id", "version")`)
    console.log(`${PREFIX} Created Order_id_version_idx`)
  } else {
    console.log(`${PREFIX} Order_id_version_idx already exists`)
  }

  console.log(`${PREFIX} Migration 104 complete — order version index added`)
}
