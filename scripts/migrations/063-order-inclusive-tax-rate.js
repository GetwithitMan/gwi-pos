/**
 * Migration 063 — Add inclusiveTaxRate to Order
 *
 * Stores the inclusive tax rate at order creation time so that
 * tax calculations survive location setting changes mid-service.
 * Items stamped isTaxInclusive=true need the ORIGINAL rate for
 * correct back-out — not the current (possibly changed) setting.
 */
async function up(prisma) {
  const col = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'inclusiveTaxRate'
  `)
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Order" ADD COLUMN "inclusiveTaxRate" DECIMAL DEFAULT 0 NOT NULL
    `)
    console.log('[migration-063] Added inclusiveTaxRate to Order')

    // Backfill existing open orders from their location's current inclusiveTaxRate setting
    // This is best-effort — closed orders keep 0 (they won't be recalculated)
    await prisma.$executeRawUnsafe(`
      UPDATE "Order" o
      SET "inclusiveTaxRate" = COALESCE(
        (SELECT (l.settings->'tax'->>'inclusiveTaxRate')::decimal / 100
         FROM "Location" l WHERE l.id = o."locationId"),
        0
      )
      WHERE o.status IN ('open', 'in_progress')
        AND o."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "OrderItem" oi
          WHERE oi."orderId" = o.id
            AND oi."isTaxInclusive" = true
            AND oi."deletedAt" IS NULL
        )
    `)
    console.log('[migration-063] Backfilled inclusiveTaxRate on open orders with inclusive items')
  }
}

module.exports = { up }
