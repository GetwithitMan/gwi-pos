/**
 * Setup Full POS Menu Script
 *
 * Does everything needed to get the bar menu production-ready:
 *
 * 1. Fix Beer & Wine categories: categoryType 'drinks' → 'liquor'
 * 2. Create POS menu items for all bottles (most on POS, skip boring dupes)
 * 3. Add spirit upgrade modifier groups to ALL cocktails
 * 4. Add Glass vs Bottle service options to wine
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-full-pos-menu.ts
 */

import { PrismaClient, Prisma, ModifierPriceType } from '@prisma/client'

const db = new PrismaClient()

// ── Standard POS pricing by tier ─────────────────────────────────────────────
const SPIRIT_PRICE: Record<string, number> = {
  well: 6.50,
  call: 9.00,
  premium: 13.00,
  top_shelf: 18.00,
}

const BEER_PRICE: Record<string, number> = {
  domestic: 5.00,
  import: 6.00,
  craft: 7.00,
  'premium craft': 9.00,
  seltzer: 5.50,
  na: 4.50,
  default: 5.50,
}

const WINE_GLASS_PRICE: Record<string, number> = {
  house: 8.00,
  'by the glass': 9.00,
  reserve: 12.00,
  'cellar select': 16.00,
  default: 9.00,
}

// Cocktail → primary spirit category name mapping
const COCKTAIL_SPIRIT: Record<string, string> = {
  'Whiskey Sour':        'Whiskey',
  'Old Fashioned':       'Whiskey',
  'Mint Julep':          'Whiskey',
  'Jack & Coke':         'Whiskey',
  'Manhattan':           'Whiskey',
  'Amaretto Sour':       'Whiskey',
  'Cosmopolitan':        'Vodka',
  'Bloody Mary':         'Vodka',
  'Lemon Drop':          'Vodka',
  'Vodka Martini':       'Vodka',
  'Screwdriver':         'Vodka',
  'Vodka Soda':          'Vodka',
  'Vodka Tonic':         'Vodka',
  'Moscow Mule':         'Vodka',
  'Espresso Martini':    'Vodka',
  'Mojito':              'Rum',
  'Daiquiri':            'Rum',
  'Pina Colada':         'Rum',
  'Dark & Stormy':       'Rum',
  'Mai Tai':             'Rum',
  'Zombie':              'Rum',
  'Cuba Libre':          'Rum',
  'Margarita':           'Tequila',
  'Frozen Margarita':    'Tequila',
  'Margarita on Rocks':  'Tequila',
  'Tequila Sunrise':     'Tequila',
  'Ranch Water':         'Tequila',
  'Mexican Mule':        'Tequila',
  'Paloma':              'Tequila',
  'Gimlet':              'Gin',
  'Gin & Tonic':         'Gin',
  'Gin Martini':         'Gin',
  'Tom Collins':         'Gin',
  'Negroni':             'Gin',
  'French 75':           'Gin',
  'Aviation':            'Gin',
  // Long Island uses multiple spirits — upgrade is Vodka (most prominent)
  'Long Island Iced Tea': 'Vodka',
}

// Tier display labels per spirit type (for the modifier name)
const SPIRIT_TIER_LABEL: Record<string, Record<string, string>> = {
  Whiskey: { call: 'Call', premium: 'Premium', top_shelf: 'Top Shelf' },
  Vodka:   { call: 'Call', premium: 'Premium', top_shelf: 'Top Shelf' },
  Rum:     { call: 'Call', premium: 'Premium', top_shelf: 'Top Shelf' },
  Tequila: { call: 'Call', premium: 'Premium', top_shelf: 'Top Shelf' },
  Gin:     { call: 'Call', premium: 'Premium', top_shelf: 'Top Shelf' },
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🍸 Setting up full POS bar menu...\n')

  const location = await db.location.findFirst()
  if (!location) throw new Error('No location found')
  console.log(`📍 Location: ${location.name}\n`)

  // ── Step 1: Fix Beer & Wine categoryType ──────────────────────────────────
  console.log('🔧 Step 1: Fixing Beer & Wine categoryType...')
  const fixedCats = await db.category.updateMany({
    where: {
      locationId: location.id,
      name: { in: ['Beer', 'Wine'] },
      categoryType: 'drinks',
    },
    data: { categoryType: 'liquor' },
  })
  console.log(`   ✓ Updated ${fixedCats.count} categories to categoryType='liquor'\n`)

  // ── Step 2: Load all needed data ──────────────────────────────────────────
  console.log('📊 Loading data...')

  const menuCats = await db.category.findMany({
    where: { locationId: location.id, deletedAt: null },
    select: { id: true, name: true, categoryType: true, sortOrder: true },
  })
  const catByName = Object.fromEntries(menuCats.map(c => [c.name.toLowerCase(), c]))

  const bottles = await db.bottleProduct.findMany({
    where: { locationId: location.id, deletedAt: null },
    include: {
      spiritCategory: true,
      linkedMenuItems: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
    orderBy: [{ spiritCategory: { name: 'asc' } }, { tier: 'asc' }, { name: 'asc' }],
  })

  const cocktails = await db.menuItem.findMany({
    where: {
      locationId: location.id,
      deletedAt: null,
      category: { name: 'Cocktails' },
    },
    include: {
      ownedModifierGroups: {
        where: { deletedAt: null },
        select: { id: true, isSpiritGroup: true },
      },
    },
  })

  console.log(`   Found ${bottles.length} bottles, ${cocktails.length} cocktails\n`)

  // ── Step 3: Put most bottles on POS ───────────────────────────────────────
  console.log('🍾 Step 2: Adding bottles to POS...')

  // Track what's already on POS and what to skip (1-2 per category, boring dupes)
  const skipByCategory: Record<string, number> = {} // how many we've skipped
  const MAX_SKIP = 2 // leave at most 2 off POS per category

  // Bottles to definitely skip (least interesting by name pattern)
  const skipPatterns = [
    /house\s+(vodka|whiskey|rum|tequila|gin)/i, // generic house bottles (keep 1)
  ]

  let created = 0
  let skipped = 0

  for (const bottle of bottles) {
    const catName = bottle.spiritCategory?.name || ''
    const alreadyOnPos = bottle.linkedMenuItems.length > 0

    if (alreadyOnPos) continue

    // Determine if we should skip this bottle (leave some off POS)
    const skipCount = skipByCategory[catName] || 0
    const shouldSkip = skipCount < MAX_SKIP && skipPatterns.some(p => p.test(bottle.name))

    if (shouldSkip) {
      skipByCategory[catName] = skipCount + 1
      skipped++
      continue
    }

    // Find the right menu category for this bottle
    const menuCat = catByName[catName.toLowerCase()]
    if (!menuCat) {
      console.log(`   ⚠️  No menu category for "${catName}" — skipping ${bottle.name}`)
      continue
    }

    // Determine price
    let price: number
    if (catName === 'Beer') {
      const subtype = (bottle as any).alcoholSubtype?.toLowerCase() || 'default'
      price = BEER_PRICE[subtype] ?? BEER_PRICE.default
    } else if (catName === 'Wine') {
      // Wine on POS = by the glass
      const tierPriceMap: Record<string, number> = {
        well: 8.00, call: 9.00, premium: 12.00, top_shelf: 16.00,
      }
      price = tierPriceMap[bottle.tier] ?? 9.00
    } else {
      price = SPIRIT_PRICE[bottle.tier] ?? 9.00
    }

    // Sort order by tier
    const sortOrderByTier: Record<string, number> = {
      well: 1, call: 100, premium: 200, top_shelf: 300,
    }

    // Create the menu item
    try {
      await db.menuItem.create({
        data: {
          locationId: location.id,
          categoryId: menuCat.id,
          name: bottle.name,
          price: new Prisma.Decimal(price),
          cost: bottle.pourCost ?? new Prisma.Decimal(0),
          itemType: 'standard',
          isActive: true,
          showOnPOS: true,
          showOnline: false,
          trackInventory: true,
          linkedBottleProductId: bottle.id,
          sortOrder: sortOrderByTier[bottle.tier] ?? 100,
          pourSizes: { shot: 1.0, double: 2.0, tall: 1.5, short: 0.75 },
          defaultPourSize: 'shot',
          applyPourToModifiers: true,
        },
      })
      created++
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Unique constraint — item already exists somehow
      } else {
        console.log(`   ⚠️  Error creating menu item for ${bottle.name}: ${err.message}`)
      }
    }
  }

  console.log(`   ✓ Created ${created} new POS menu items, left ${skipped} off POS\n`)

  // ── Step 4: Spirit upgrades for all cocktails ─────────────────────────────
  console.log('🥃 Step 3: Adding spirit upgrade groups to cocktails...')

  // Pre-load spirit bottles by category and tier for efficient lookup
  const spiritBottlesByTier: Record<string, Record<string, { id: string; name: string; pourCost: Prisma.Decimal | null }[]>> = {}
  for (const bottle of bottles) {
    const cat = bottle.spiritCategory?.name || ''
    const tier = bottle.tier || ''
    if (!spiritBottlesByTier[cat]) spiritBottlesByTier[cat] = {}
    if (!spiritBottlesByTier[cat][tier]) spiritBottlesByTier[cat][tier] = []
    spiritBottlesByTier[cat][tier].push({
      id: bottle.id,
      name: bottle.name,
      pourCost: bottle.pourCost,
    })
  }

  // Pick the best representative bottle for each tier
  // Strategy: prefer popular/recognizable brands, avoid "House" in call/premium/top
  const PREFERRED: Record<string, Record<string, string[]>> = {
    Whiskey: {
      call:      ['Jack Daniels', 'Jameson', 'Buffalo Trace', 'Bulleit Bourbon'],
      premium:   ['Knob Creek', 'Woodford Reserve', 'Gentleman Jack'],
      top_shelf: ["Blanton's", 'Pappy Van Winkle', 'Weller Special Reserve', 'Macallan 12'],
    },
    Vodka: {
      call:      ["Tito's", 'Absolut', 'Deep Eddy', 'Svedka'],
      premium:   ['Grey Goose', 'Belvedere', 'Ketel One', 'Ciroc'],
      top_shelf: ['Belvedere', 'Grey Goose', 'Chopin'],
    },
    Rum: {
      call:      ['Bacardi Superior', 'Captain Morgan Original', 'Malibu Original'],
      premium:   ['Ron Zacapa 23', 'Diplomatico Reserva', 'Appleton Estate 12'],
      top_shelf: ['Ron Zacapa 23', 'Diplomatico Exclusiva', 'Mount Gay XO'],
    },
    Tequila: {
      call:      ['Hornitos Plata', 'Espolon Blanco', 'El Jimador Blanco'],
      premium:   ['Patron Silver', 'Don Julio Blanco', 'Casamigos Blanco'],
      top_shelf: ['Don Julio 1942', 'Clase Azul Plata', 'Codigo 1530 Rosa'],
    },
    Gin: {
      call:      ["Hendrick's", "Tanqueray", "Beefeater", "Bombay Sapphire"],
      premium:   ["Hendrick's", "The Botanist", "Monkey 47"],
      top_shelf: ["Monkey 47", "The Botanist", "Hendrick's Orbium"],
    },
  }

  function pickBestBottle(spiritName: string, tier: string) {
    const available = spiritBottlesByTier[spiritName]?.[tier] ?? []
    if (available.length === 0) return null
    const preferred = PREFERRED[spiritName]?.[tier] ?? []
    for (const pref of preferred) {
      const found = available.find(b => b.name.toLowerCase().includes(pref.toLowerCase()))
      if (found) return found
    }
    return available[0] // fallback to first available
  }

  let cocktailsUpdated = 0
  let cocktailsSkipped = 0

  for (const cocktail of cocktails) {
    // Already has a spirit group?
    const hasSpiritGroup = cocktail.ownedModifierGroups.some(g => g.isSpiritGroup)
    if (hasSpiritGroup) {
      cocktailsSkipped++
      continue
    }

    const spiritName = COCKTAIL_SPIRIT[cocktail.name]
    if (!spiritName) {
      console.log(`   ⚠️  No spirit mapping for "${cocktail.name}" — skipping`)
      continue
    }

    // Find bottles for each tier
    const callBottle     = pickBestBottle(spiritName, 'call')
    const premiumBottle  = pickBestBottle(spiritName, 'premium')
    const topBottle      = pickBestBottle(spiritName, 'top_shelf')

    if (!callBottle && !premiumBottle && !topBottle) {
      console.log(`   ⚠️  No bottles found for ${spiritName} — skipping ${cocktail.name}`)
      continue
    }

    // Create the spirit upgrade modifier group
    const group = await db.modifierGroup.create({
      data: {
        locationId: location.id,
        menuItemId: cocktail.id,
        name: `${spiritName} Upgrade`,
        isSpiritGroup: true,
        minSelections: 0,
        maxSelections: 1,
        isRequired: false,
        allowStacking: false,
        sortOrder: 0,
        modifierTypes: ['liquor'],
        showOnline: true,
      },
    })

    // Add modifiers for each available tier
    const modifiersToCreate: Array<{
      locationId: string
      modifierGroupId: string
      name: string
      price: Prisma.Decimal
      priceType: ModifierPriceType
      spiritTier: string
      linkedBottleProductId: string
      isActive: boolean
      showOnPOS: boolean
      showOnline: boolean
      sortOrder: number
    }> = []

    const tierLabels = SPIRIT_TIER_LABEL[spiritName] ?? {}

    if (callBottle) {
      const upcharge = Number(callBottle.pourCost ?? 0)
      modifiersToCreate.push({
        locationId: location.id,
        modifierGroupId: group.id,
        name: `${tierLabels.call ?? 'Call'} (${callBottle.name})`,
        price: new Prisma.Decimal(Math.max(0, upcharge)),
        priceType: 'upcharge',
        spiritTier: 'call',
        linkedBottleProductId: callBottle.id,
        isActive: true,
        showOnPOS: true,
        showOnline: true,
        sortOrder: 1,
      })
    }
    if (premiumBottle) {
      const upcharge = Number(premiumBottle.pourCost ?? 0)
      modifiersToCreate.push({
        locationId: location.id,
        modifierGroupId: group.id,
        name: `${tierLabels.premium ?? 'Premium'} (${premiumBottle.name})`,
        price: new Prisma.Decimal(Math.max(0, upcharge)),
        priceType: 'upcharge',
        spiritTier: 'premium',
        linkedBottleProductId: premiumBottle.id,
        isActive: true,
        showOnPOS: true,
        showOnline: true,
        sortOrder: 2,
      })
    }
    if (topBottle) {
      const upcharge = Number(topBottle.pourCost ?? 0)
      modifiersToCreate.push({
        locationId: location.id,
        modifierGroupId: group.id,
        name: `${tierLabels.top_shelf ?? 'Top Shelf'} (${topBottle.name})`,
        price: new Prisma.Decimal(Math.max(0, upcharge)),
        priceType: 'upcharge',
        spiritTier: 'top_shelf',
        linkedBottleProductId: topBottle.id,
        isActive: true,
        showOnPOS: true,
        showOnline: true,
        sortOrder: 3,
      })
    }

    await db.modifier.createMany({ data: modifiersToCreate })
    cocktailsUpdated++
  }

  console.log(`   ✓ Added spirit upgrade groups to ${cocktailsUpdated} cocktails (${cocktailsSkipped} already had them)\n`)

  // ── Step 5: Wine glass vs bottle service options ──────────────────────────
  console.log('🍷 Step 4: Adding Glass / Bottle options to wine...')

  const wineMenuItems = await db.menuItem.findMany({
    where: {
      locationId: location.id,
      deletedAt: null,
      category: { name: 'Wine' },
    },
    include: {
      ownedModifierGroups: {
        where: { deletedAt: null },
        select: { id: true, name: true },
      },
      linkedBottleProduct: {
        select: { bottleSizeMl: true, pourSizeOz: true, poursPerBottle: true, unitCost: true, tier: true },
      },
    },
  })

  let wineUpdated = 0
  for (const wineItem of wineMenuItems) {
    // Already has a service group?
    const hasServiceGroup = wineItem.ownedModifierGroups.some(g => g.name.toLowerCase().includes('service') || g.name.toLowerCase().includes('glass') || g.name.toLowerCase().includes('bottle'))
    if (hasServiceGroup) continue

    const bottleData = wineItem.linkedBottleProduct
    const bottlePrice = Number(wineItem.price)
    // Bottle price = ~3.5x glass price
    const bottleUpsell = Math.round(bottlePrice * 3.5 * 100) / 100

    const group = await db.modifierGroup.create({
      data: {
        locationId: location.id,
        menuItemId: wineItem.id,
        name: 'Service',
        isSpiritGroup: false,
        minSelections: 0,
        maxSelections: 1,
        isRequired: false,
        allowStacking: false,
        sortOrder: 0,
        modifierTypes: ['liquor'],
        showOnline: true,
      },
    })

    await db.modifier.createMany({
      data: [
        {
          locationId: location.id,
          modifierGroupId: group.id,
          name: 'By the Glass',
          price: new Prisma.Decimal(0), // base price
          priceType: 'upcharge',
          isActive: true,
          showOnPOS: true,
          showOnline: true,
          sortOrder: 1,
        },
        {
          locationId: location.id,
          modifierGroupId: group.id,
          name: 'Full Bottle',
          price: new Prisma.Decimal(bottleUpsell),
          priceType: 'upcharge',
          isActive: true,
          showOnPOS: true,
          showOnline: true,
          sortOrder: 2,
        },
      ],
    })
    wineUpdated++
  }

  console.log(`   ✓ Added Glass/Bottle options to ${wineUpdated} wine items\n`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════')
  console.log('✅ Full POS menu setup complete!')
  console.log('═══════════════════════════════════════')
  console.log(`  Beer & Wine categories fixed: ${fixedCats.count}`)
  console.log(`  Bottles added to POS: ${created}`)
  console.log(`  Bottles left off POS: ${skipped}`)
  console.log(`  Cocktails with spirit upgrades: ${cocktailsUpdated + cocktailsSkipped}`)
  console.log(`  Wine items with glass/bottle: ${wineUpdated}`)
  console.log('')
  console.log('Next: Refresh the POS and verify everything looks right!')
}

main()
  .catch(e => { console.error('\n❌ Error:', e); process.exit(1) })
  .finally(() => db.$disconnect().catch(() => {}))
