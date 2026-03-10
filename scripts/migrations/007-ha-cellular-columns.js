/**
 * Migration 007: HA Cellular columns
 *
 * Adds FulfillmentType enum, MenuItem fulfillment columns,
 * lastMutatedBy/originTerminalId to Order/OrderItem/Payment/OrderDiscount/OrderCard/OrderItemModifier.
 */

const { columnExists, tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[007-ha-cellular-columns]'

  // --- FulfillmentType enum ---
  try {
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN CREATE TYPE "FulfillmentType" AS ENUM ('SELF_FULFILL', 'KITCHEN_STATION', 'BAR_STATION', 'PREP_STATION', 'NO_ACTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    )
    console.log(`${PREFIX}   FulfillmentType enum ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED FulfillmentType enum:`, err.message)
  }

  // --- MenuItem.fulfillmentType + MenuItem.fulfillmentStationId ---
  try {
    const hasFulfillmentType = await columnExists(prisma, 'MenuItem', 'fulfillmentType')
    if (!hasFulfillmentType) {
      console.log(`${PREFIX}   Adding MenuItem.fulfillmentType...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "MenuItem" ADD COLUMN "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'KITCHEN_STATION'`)
      console.log(`${PREFIX}   Done -- MenuItem.fulfillmentType added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED MenuItem.fulfillmentType:`, err.message)
  }
  try {
    const hasFulfillmentStationId = await columnExists(prisma, 'MenuItem', 'fulfillmentStationId')
    if (!hasFulfillmentStationId) {
      console.log(`${PREFIX}   Adding MenuItem.fulfillmentStationId...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "MenuItem" ADD COLUMN "fulfillmentStationId" TEXT`)
      console.log(`${PREFIX}   Done -- MenuItem.fulfillmentStationId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED MenuItem.fulfillmentStationId:`, err.message)
  }

  // --- lastMutatedBy + originTerminalId on Order/OrderItem/Payment/OrderDiscount/OrderCard/OrderItemModifier ---
  const lastMutatedByTables = ['Order', 'OrderItem', 'Payment', 'OrderDiscount', 'OrderCard', 'OrderItemModifier']
  for (const table of lastMutatedByTables) {
    try {
      const tblExists = await tableExists(prisma, table)
      if (!tblExists) continue
      const has = await columnExists(prisma, table, 'lastMutatedBy')
      if (!has) {
        console.log(`${PREFIX}   Adding ${table}.lastMutatedBy...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "lastMutatedBy" TEXT`)
        console.log(`${PREFIX}   Done -- ${table}.lastMutatedBy added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ${table}.lastMutatedBy:`, err.message)
    }
  }

  // --- Order.originTerminalId ---
  try {
    const has = await columnExists(prisma, 'Order', 'originTerminalId')
    if (!has) {
      console.log(`${PREFIX}   Adding Order.originTerminalId...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "originTerminalId" TEXT`)
      console.log(`${PREFIX}   Done -- Order.originTerminalId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Order.originTerminalId:`, err.message)
  }
}

module.exports = { up }
