/** Add lastMutatedBy to newly bidirectional models */
exports.up = async function up(prisma) {
  const models = [
    'TipOutRule', 'TipPool', 'TipGroupTemplate', 'PayrollPeriod', 'PayStub',
    'BottleServiceTier', 'RecipeIngredient', 'MenuItemRecipeIngredient',
    'MenuItemIngredient', 'IngredientSwapGroup', 'IngredientRecipe',
    'IngredientCostHistory', 'MarginEdgeProductMapping', 'InventoryCount',
    'InventoryCountItem', 'InventoryCountEntry', 'WasteLog', 'WasteLogEntry',
    'VendorOrder', 'VendorOrderLineItem', 'IngredientStockAdjustment',
    'DailyPrepCount', 'DailyPrepCountItem', 'ChargebackCase',
    'ReservationBlock', 'ReservationDeposit', 'ReservationEvent',
    'ShiftSwapRequest', 'MenuItemRecipe', 'Customer', 'GiftCard',
    'HouseAccount', 'Reservation', 'EntertainmentWaitlist', 'Seat',
    'PizzaConfig', 'PizzaSize', 'PizzaCrust', 'PizzaSauce', 'PizzaCheese',
    'PizzaTopping', 'PizzaSpecialty'
  ]
  for (const table of models) {
    const exists = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_name = '${table}' AND column_name = 'lastMutatedBy'`
    )
    if (exists.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "lastMutatedBy" TEXT`)
    }
  }
}
