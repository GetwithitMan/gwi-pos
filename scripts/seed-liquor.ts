/**
 * seed-liquor.ts
 *
 * Populates the liquor builder with real-world bar data:
 *   - 9 spirit categories (Vodka, Gin, Rum, Tequila, Whiskey, Bourbon, Scotch, Brandy, Cordials)
 *   - 40 bottle products across well / call / premium / top_shelf tiers
 *   - 4 VIP bottle service tiers (Bronze / Silver / Gold / Platinum)
 *   - 8 base spirit menu items with Shot / Double / Tall pour sizes
 *   - Spirit tier upgrade modifier groups attached to each menu item
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/seed-liquor.ts
 *   (or: npm run db:seed-liquor)
 *
 * Safe to re-run — all operations use upsert.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const LOC = 'loc-1'

// ─── Pour size options (stored as JSON on MenuItem) ───────────────────────────
const SPIRIT_POUR_SIZES = {
  shot:   { label: 'Shot',   multiplier: 1.0 },
  double: { label: 'Double', multiplier: 2.0 },
  tall:   { label: 'Tall',   multiplier: 1.5 },
}

// ─── Tier metadata: label, upcharge, sort, default flag ──────────────────────
const TIERS: Record<string, { label: string; upcharge: number; sortOrder: number; isDefault: boolean }> = {
  well:      { label: 'Well',      upcharge: 0.00, sortOrder: 1, isDefault: true  },
  call:      { label: 'Call',      upcharge: 2.50, sortOrder: 2, isDefault: false },
  premium:   { label: 'Premium',   upcharge: 5.00, sortOrder: 3, isDefault: false },
  top_shelf: { label: 'Top Shelf', upcharge: 8.00, sortOrder: 4, isDefault: false },
}

// ─── The eight main spirit categories + their bottles ────────────────────────
const SPIRITS = [
  {
    catId:      'sc-vodka',
    catName:    'Vodka',
    menuItemId: 'mi-vodka',
    mgId:       'mg-vodka',
    smgId:      'smg-vodka',
    basePrice:  7.00,
    sortOrder:  1,
    bottles: [
      { id: 'bottle-vodka-well',    tier: 'well',      name: "Gordon's Vodka",        brand: "Gordon's",       ml: 1750, cost: 18.00, so: 1 },
      { id: 'bottle-vodka-call',    tier: 'call',      name: 'Smirnoff No. 21',       brand: 'Smirnoff',       ml: 1000, cost: 22.00, so: 2 },
      { id: 'bottle-vodka-premium', tier: 'premium',   name: "Tito's Handmade Vodka", brand: "Tito's",          ml:  750, cost: 28.00, so: 3 },
      { id: 'bottle-vodka-top',     tier: 'top_shelf', name: 'Grey Goose',            brand: 'Grey Goose',      ml:  750, cost: 42.00, so: 4 },
    ],
  },
  {
    catId:      'sc-gin',
    catName:    'Gin',
    menuItemId: 'mi-gin',
    mgId:       'mg-gin',
    smgId:      'smg-gin',
    basePrice:  7.00,
    sortOrder:  2,
    bottles: [
      { id: 'bottle-gin-well',      tier: 'well',      name: "Gordon's Gin",          brand: "Gordon's",       ml: 1750, cost: 18.00, so: 1 },
      { id: 'bottle-gin-call',      tier: 'call',      name: 'Beefeater London Dry',  brand: 'Beefeater',       ml:  750, cost: 22.00, so: 2 },
      { id: 'bottle-gin-premium',   tier: 'premium',   name: 'Bombay Sapphire',       brand: 'Bombay',          ml:  750, cost: 30.00, so: 3 },
      { id: 'bottle-gin-top',       tier: 'top_shelf', name: "Hendrick's",            brand: "Hendrick's",      ml:  750, cost: 44.00, so: 4 },
    ],
  },
  {
    catId:      'sc-rum',
    catName:    'Rum',
    menuItemId: 'mi-rum',
    mgId:       'mg-rum',
    smgId:      'smg-rum',
    basePrice:  7.00,
    sortOrder:  3,
    bottles: [
      { id: 'bottle-rum-well',      tier: 'well',      name: 'Cruzan Estate Light',   brand: 'Cruzan',         ml: 1750, cost: 20.00, so: 1 },
      { id: 'bottle-rum-call',      tier: 'call',      name: 'Bacardi Superior White', brand: 'Bacardi',        ml:  750, cost: 18.00, so: 2 },
      { id: 'bottle-rum-premium',   tier: 'premium',   name: 'Captain Morgan Spiced', brand: 'Captain Morgan',  ml:  750, cost: 24.00, so: 3 },
      { id: 'bottle-rum-top',       tier: 'top_shelf', name: 'Diplomatico Reserva',   brand: 'Diplomatico',     ml:  750, cost: 52.00, so: 4 },
    ],
  },
  {
    catId:      'sc-tequila',
    catName:    'Tequila',
    menuItemId: 'mi-tequila',
    mgId:       'mg-tequila',
    smgId:      'smg-tequila',
    basePrice:  8.00,
    sortOrder:  4,
    bottles: [
      { id: 'bottle-tequila-well',    tier: 'well',      name: 'Montezuma Gold',            brand: 'Montezuma',   ml: 1750, cost: 16.00, so: 1 },
      { id: 'bottle-tequila-call',    tier: 'call',      name: 'Jose Cuervo Especial Gold',  brand: 'Jose Cuervo', ml:  750, cost: 24.00, so: 2 },
      { id: 'bottle-tequila-premium', tier: 'premium',   name: 'Patrón Silver',              brand: 'Patrón',       ml:  750, cost: 54.00, so: 3 },
      { id: 'bottle-tequila-top',     tier: 'top_shelf', name: 'Don Julio Reposado',         brand: 'Don Julio',    ml:  750, cost: 68.00, so: 4 },
    ],
  },
  {
    catId:      'sc-whiskey',
    catName:    'Whiskey',
    menuItemId: 'mi-whiskey',
    mgId:       'mg-whiskey',
    smgId:      'smg-whiskey',
    basePrice:  7.00,
    sortOrder:  5,
    bottles: [
      { id: 'bottle-whiskey-well',    tier: 'well',      name: "Seagram's 7",             brand: "Seagram's",       ml: 1750, cost: 22.00, so: 1 },
      { id: 'bottle-whiskey-call',    tier: 'call',      name: 'Jim Beam White',           brand: 'Jim Beam',        ml:  750, cost: 20.00, so: 2 },
      { id: 'bottle-whiskey-premium', tier: 'premium',   name: "Jack Daniel's Old No. 7",  brand: "Jack Daniel's",   ml:  750, cost: 30.00, so: 3 },
      { id: 'bottle-whiskey-top',     tier: 'top_shelf', name: 'Knob Creek 9yr',           brand: 'Knob Creek',      ml:  750, cost: 40.00, so: 4 },
    ],
  },
  {
    catId:      'sc-bourbon',
    catName:    'Bourbon',
    menuItemId: 'mi-bourbon',
    mgId:       'mg-bourbon',
    smgId:      'smg-bourbon',
    basePrice:  8.00,
    sortOrder:  6,
    bottles: [
      { id: 'bottle-bourbon-well',    tier: 'well',      name: 'Old Crow Bourbon',    brand: 'Old Crow',        ml: 1750, cost: 18.00, so: 1 },
      { id: 'bottle-bourbon-call',    tier: 'call',      name: 'Evan Williams Black', brand: 'Evan Williams',   ml:  750, cost: 18.00, so: 2 },
      { id: 'bottle-bourbon-premium', tier: 'premium',   name: 'Bulleit Bourbon',     brand: 'Bulleit',          ml:  750, cost: 36.00, so: 3 },
      { id: 'bottle-bourbon-top',     tier: 'top_shelf', name: 'Woodford Reserve',    brand: 'Woodford Reserve', ml:  750, cost: 50.00, so: 4 },
    ],
  },
  {
    catId:      'sc-scotch',
    catName:    'Scotch',
    menuItemId: 'mi-scotch',
    mgId:       'mg-scotch',
    smgId:      'smg-scotch',
    basePrice:  9.00,
    sortOrder:  7,
    bottles: [
      { id: 'bottle-scotch-well',    tier: 'well',      name: "Dewar's White Label",       brand: "Dewar's",        ml: 750, cost: 26.00, so: 1 },
      { id: 'bottle-scotch-call',    tier: 'call',      name: 'Johnnie Walker Red Label',  brand: 'Johnnie Walker', ml: 750, cost: 30.00, so: 2 },
      { id: 'bottle-scotch-premium', tier: 'premium',   name: 'Glenfiddich 12yr',          brand: 'Glenfiddich',    ml: 750, cost: 44.00, so: 3 },
      { id: 'bottle-scotch-top',     tier: 'top_shelf', name: 'Macallan 12yr Sherry Oak',  brand: 'Macallan',       ml: 750, cost: 72.00, so: 4 },
    ],
  },
  {
    catId:      'sc-brandy',
    catName:    'Brandy & Cognac',
    menuItemId: 'mi-brandy',
    mgId:       'mg-brandy',
    smgId:      'smg-brandy',
    basePrice:  8.00,
    sortOrder:  8,
    bottles: [
      { id: 'bottle-brandy-well',    tier: 'well',      name: 'Christian Brothers Brandy', brand: 'Christian Brothers', ml: 1750, cost: 20.00, so: 1 },
      { id: 'bottle-brandy-call',    tier: 'call',      name: 'E&J VSOP Brandy',           brand: 'E&J',               ml:  750, cost: 22.00, so: 2 },
      { id: 'bottle-brandy-premium', tier: 'premium',   name: 'Hennessy VS',               brand: 'Hennessy',           ml:  750, cost: 44.00, so: 3 },
      { id: 'bottle-brandy-top',     tier: 'top_shelf', name: 'Hennessy VSOP',             brand: 'Hennessy',           ml:  750, cost: 72.00, so: 4 },
    ],
  },
]

// ─── Cordials & Liqueurs (individual products — no tier upgrade system) ───────
const CORDIALS_CAT_ID = 'sc-cordials'
const CORDIALS_BOTTLES = [
  { id: 'bottle-cordial-triplesec',    tier: 'well',      name: 'DeKuyper Triple Sec',          brand: 'DeKuyper',      ml: 750, cost: 12.00, so: 1 },
  { id: 'bottle-cordial-schnapps',     tier: 'well',      name: 'DeKuyper Peach Schnapps',      brand: 'DeKuyper',      ml: 750, cost: 14.00, so: 2 },
  { id: 'bottle-cordial-kahlua',       tier: 'call',      name: 'Kahlúa Coffee Liqueur',        brand: 'Kahlúa',        ml: 750, cost: 28.00, so: 3 },
  { id: 'bottle-cordial-midori',       tier: 'call',      name: 'Midori Melon Liqueur',         brand: 'Midori',        ml: 750, cost: 24.00, so: 4 },
  { id: 'bottle-cordial-amaretto',     tier: 'premium',   name: 'Amaretto di Saronno',          brand: 'Di Saronno',    ml: 750, cost: 32.00, so: 5 },
  { id: 'bottle-cordial-baileys',      tier: 'premium',   name: "Bailey's Irish Cream",         brand: "Bailey's",      ml: 750, cost: 34.00, so: 6 },
  { id: 'bottle-cordial-chambord',     tier: 'premium',   name: 'Chambord Raspberry Liqueur',   brand: 'Chambord',      ml: 750, cost: 36.00, so: 7 },
  { id: 'bottle-cordial-grandmarnier', tier: 'top_shelf', name: 'Grand Marnier Cordon Rouge',   brand: 'Grand Marnier', ml: 750, cost: 44.00, so: 8 },
]

// ─── VIP Bottle Service Tiers ─────────────────────────────────────────────────
const BOTTLE_SERVICE_TIERS = [
  {
    id:                  'bst-bronze',
    name:                'Bronze',
    description:         'Reserved section for up to 4 guests. Includes mixers and garnishes.',
    color:               '#CD7F32',
    depositAmount:       150,
    minimumSpend:        300,
    autoGratuityPercent: 18,
    sortOrder:           1,
  },
  {
    id:                  'bst-silver',
    name:                'Silver',
    description:         'Premium section for up to 6 guests. Includes mixers, garnishes, and a fruit tray.',
    color:               '#A8A9AD',
    depositAmount:       300,
    minimumSpend:        750,
    autoGratuityPercent: 18,
    sortOrder:           2,
  },
  {
    id:                  'bst-gold',
    name:                'Gold',
    description:         'VIP booth for up to 8 guests. Dedicated server, premium mixers, and appetizer spread.',
    color:               '#D4AF37',
    depositAmount:       500,
    minimumSpend:        1500,
    autoGratuityPercent: 20,
    sortOrder:           3,
  },
  {
    id:                  'bst-platinum',
    name:                'Platinum',
    description:         'Private VIP room for up to 15 guests. Full host service, premium bottle list, and custom presentation.',
    color:               '#E5E4E2',
    depositAmount:       1000,
    minimumSpend:        3000,
    autoGratuityPercent: 22,
    sortOrder:           4,
  },
]

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🍸 GWI Liquor Builder Seed\n')

  // ── 1. Menu Category for spirit items ──────────────────────────────────────
  console.log('  [1/5] Creating "Spirits" menu category...')
  const spiritsMenuCat = await prisma.category.upsert({
    where: { id: 'cat-bar-spirits' },
    update: {},
    create: {
      id:           'cat-bar-spirits',
      locationId:   LOC,
      name:         'Spirits',
      displayName:  'Bar Spirits',
      description:  'House spirits — select your pour size and upgrade tier',
      categoryType: 'liquor',
      sortOrder:    10,
      isActive:     true,
      showOnPOS:    true,
    },
  })
  console.log(`  ✓ Menu category: ${spiritsMenuCat.name} (id: ${spiritsMenuCat.id})`)

  // ── 2. Spirit Categories ───────────────────────────────────────────────────
  console.log('\n  [2/5] Creating spirit categories...')

  await prisma.spiritCategory.upsert({
    where: { id: CORDIALS_CAT_ID },
    update: {},
    create: {
      id:           CORDIALS_CAT_ID,
      locationId:   LOC,
      name:         'Cordials & Liqueurs',
      categoryType: 'spirit',
      sortOrder:    9,
      isActive:     true,
    },
  })

  for (const spirit of SPIRITS) {
    await prisma.spiritCategory.upsert({
      where: { id: spirit.catId },
      update: {},
      create: {
        id:           spirit.catId,
        locationId:   LOC,
        name:         spirit.catName,
        categoryType: 'spirit',
        sortOrder:    spirit.sortOrder,
        isActive:     true,
      },
    })
    process.stdout.write(`  ✓ ${spirit.catName}  `)
  }
  console.log(`\n  ✓ Cordials & Liqueurs`)

  // ── 3. Bottle Products ────────────────────────────────────────────────────
  console.log('\n  [3/5] Creating bottle products...')

  for (const bottle of CORDIALS_BOTTLES) {
    await prisma.bottleProduct.upsert({
      where: { id: bottle.id },
      update: {},
      create: {
        id:              bottle.id,
        locationId:      LOC,
        spiritCategoryId:CORDIALS_CAT_ID,
        name:            bottle.name,
        brand:           bottle.brand,
        tier:            bottle.tier,
        bottleSizeMl:    bottle.ml,
        unitCost:        bottle.cost,
        containerType:   'bottle',
        currentStock:    0,
        isActive:        true,
        sortOrder:       bottle.so,
      },
    })
  }
  console.log(`  ✓ ${CORDIALS_BOTTLES.length} cordial / liqueur bottles`)

  let spiritBottleCount = 0
  for (const spirit of SPIRITS) {
    for (const bottle of spirit.bottles) {
      await prisma.bottleProduct.upsert({
        where: { id: bottle.id },
        update: {},
        create: {
          id:              bottle.id,
          locationId:      LOC,
          spiritCategoryId:spirit.catId,
          name:            bottle.name,
          brand:           bottle.brand,
          tier:            bottle.tier,
          bottleSizeMl:    bottle.ml,
          unitCost:        bottle.cost,
          containerType:   'bottle',
          currentStock:    0,
          isActive:        true,
          sortOrder:       bottle.so,
        },
      })
      spiritBottleCount++
    }
  }
  console.log(`  ✓ ${spiritBottleCount} spirit bottles (${SPIRITS.length} categories × 4 tiers)`)

  // ── 4. Bottle Service Tiers ───────────────────────────────────────────────
  console.log('\n  [4/5] Creating bottle service tiers...')
  for (const bst of BOTTLE_SERVICE_TIERS) {
    await prisma.bottleServiceTier.upsert({
      where: { id: bst.id },
      update: {},
      create: {
        id:                  bst.id,
        locationId:          LOC,
        name:                bst.name,
        description:         bst.description,
        color:               bst.color,
        depositAmount:       bst.depositAmount,
        minimumSpend:        bst.minimumSpend,
        autoGratuityPercent: bst.autoGratuityPercent,
        sortOrder:           bst.sortOrder,
        isActive:            true,
      },
    })
    console.log(`  ✓ ${bst.name.padEnd(10)} $${String(bst.depositAmount).padStart(5)} deposit  /  $${String(bst.minimumSpend).padStart(5)} min spend  /  ${bst.autoGratuityPercent}% auto-grat`)
  }

  // ── 5. Spirit Menu Items + Tier Upgrade Groups ────────────────────────────
  console.log('\n  [5/5] Creating spirit menu items + tier upgrade modifier groups...')

  for (const spirit of SPIRITS) {
    // 5a — Menu item (e.g. "Vodka" — $7 shot, upgradeable)
    await prisma.menuItem.upsert({
      where: { id: spirit.menuItemId },
      update: {},
      create: {
        id:                  spirit.menuItemId,
        locationId:          LOC,
        categoryId:          spiritsMenuCat.id,
        name:                spirit.catName,
        price:               spirit.basePrice,
        itemType:            'standard',
        pourSizes:           SPIRIT_POUR_SIZES,
        defaultPourSize:     'shot',
        applyPourToModifiers:true,
        isActive:            true,
        showOnPOS:           true,
        sortOrder:           spirit.sortOrder,
      },
    })

    // 5b — Spirit modifier group (owned by this menu item)
    const modGroup = await prisma.modifierGroup.upsert({
      where: { id: spirit.mgId },
      update: {},
      create: {
        id:            spirit.mgId,
        locationId:    LOC,
        menuItemId:    spirit.menuItemId,
        name:          'Spirit Upgrades',
        modifierTypes: ['liquor'],
        isSpiritGroup: true,
        minSelections: 1,
        maxSelections: 1,
        isRequired:    true,
        sortOrder:     0,
      },
    })

    // 5c — One modifier per tier, linked to the corresponding bottle
    for (const bottle of spirit.bottles) {
      const tier = TIERS[bottle.tier]
      const safeCatName = spirit.catId.replace('sc-', '')
      const safeTier    = bottle.tier.replace('_', '-')
      const modId       = `m-${safeCatName}-${safeTier}`

      await prisma.modifier.upsert({
        where: { id: modId },
        update: {},
        create: {
          id:                   modId,
          locationId:           LOC,
          modifierGroupId:      modGroup.id,
          name:                 bottle.name,
          displayName:          tier.label,
          price:                tier.upcharge,
          priceType:            'upcharge',
          spiritTier:           bottle.tier,
          linkedBottleProductId:bottle.id,
          isDefault:            tier.isDefault,
          isActive:             true,
          showOnPOS:            true,
          sortOrder:            tier.sortOrder,
          printerRouting:       'follow',
        },
      })
    }

    // 5d — SpiritModifierGroup links the group to the spirit category
    await prisma.spiritModifierGroup.upsert({
      where: { modifierGroupId: modGroup.id },
      update: {},
      create: {
        id:              spirit.smgId,
        locationId:      LOC,
        modifierGroupId: modGroup.id,
        spiritCategoryId:spirit.catId,
        upsellEnabled:   true,
        upsellPromptText:`Upgrade your ${spirit.catName}?`,
        defaultTier:     'well',
      },
    })

    const tierStr = `$${spirit.basePrice.toFixed(2)} well / +$2.50 call / +$5.00 premium / +$8.00 top`
    console.log(`  ✓ ${spirit.catName.padEnd(16)} ${tierStr}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const catCount    = await prisma.spiritCategory.count({ where: { locationId: LOC } })
  const bottleCount = await prisma.bottleProduct.count({ where: { locationId: LOC } })
  const bstCount    = await prisma.bottleServiceTier.count({ where: { locationId: LOC } })

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Liquor builder seeded successfully!

  Spirit Categories:      ${catCount}
  Bottle Products:        ${bottleCount}
  Spirit Menu Items:      ${SPIRITS.length}  (Vodka · Gin · Rum · Tequila · Whiskey · Bourbon · Scotch · Brandy)
  Tier Upgrade Groups:    ${SPIRITS.length}  (each with Well / Call / Premium / Top Shelf)
  Bottle Service Tiers:   ${bstCount}  (Bronze · Silver · Gold · Platinum)

Pour Sizes (all spirit items):
  Shot      1.0× — base price
  Double    2.0× — base price × 2
  Tall      1.5× — base price × 1.5
  (Pour multiplier applies to tier upcharges too)

Tier Upcharges (above well price):
  Well       +$0.00   (default — house pour)
  Call       +$2.50
  Premium    +$5.00
  Top Shelf  +$8.00

Bottle Service Tiers:
  Bronze    $150 deposit · $300 min · 18% auto-grat
  Silver    $300 deposit · $750 min · 18% auto-grat
  Gold      $500 deposit · $1,500 min · 20% auto-grat
  Platinum  $1,000 deposit · $3,000 min · 22% auto-grat

Next steps:
  1. /liquor-builder → Bottles tab — set stock levels for each bottle
  2. /liquor-builder → Drinks tab — create cocktails via "Create Menu Item"
     on any bottle; spirit tier upgrades auto-attach via the category
  3. Adjust prices to match your market (this is a real-world starting point)
  4. /liquor-builder → Inventory tab — sync bottles to unified inventory
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

main()
  .catch((e) => {
    console.error('\n❌ Error during liquor seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
