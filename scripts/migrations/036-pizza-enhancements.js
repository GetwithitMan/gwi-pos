'use strict'
module.exports = {
  name: 'pizza-enhancements',
  async up(db) {
    // PizzaConfig: add condiment section settings
    await db.$executeRawUnsafe(`ALTER TABLE "PizzaConfig" ADD COLUMN IF NOT EXISTS "allowCondimentSections" BOOLEAN NOT NULL DEFAULT false`)
    await db.$executeRawUnsafe(`ALTER TABLE "PizzaConfig" ADD COLUMN IF NOT EXISTS "condimentDivisionMax" INTEGER NOT NULL DEFAULT 1`)

    // Update sectionOptions default to include thirds and sixths
    await db.$executeRawUnsafe(`
      UPDATE "PizzaConfig" SET "sectionOptions" = '[1, 2, 3, 4, 6, 8]'::jsonb
      WHERE "sectionOptions" = '[1, 2, 4, 8]'::jsonb
    `)

    // OrderItemPizza: add section-based condiment fields
    await db.$executeRawUnsafe(`ALTER TABLE "OrderItemPizza" ADD COLUMN IF NOT EXISTS "sauceSections" JSONB`)
    await db.$executeRawUnsafe(`ALTER TABLE "OrderItemPizza" ADD COLUMN IF NOT EXISTS "cheeseSections" JSONB`)
  }
}
