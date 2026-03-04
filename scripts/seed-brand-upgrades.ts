/**
 * seed-brand-upgrades.ts
 *
 * Expands cocktail spirit upgrade groups with real-world brand names and pricing.
 * Replaces the generic Well / Call / Premium / Top Shelf modifiers with actual
 * brand names (Smirnoff, Absolut, Tito's, Ketel One, Grey Goose, Belvedere, etc.)
 * and adds new brand BottleProducts for every spirit category.
 *
 * Requires seed-liquor.ts + seed-cocktails.ts to have already been run.
 *
 * Safe to re-run (idempotent): deletes old upgrade modifiers, recreates fresh.
 *
 * Usage:
 *   npm run db:seed-brands
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const LOC = 'loc-1'

// ─── New brand bottles (added on top of the 4 tier bottles from seed-liquor.ts) ──
const NEW_BOTTLES = [
  // ── Vodka ──────────────────────────────────────────────────────────────────
  { id: 'bottle-vodka-absolut',    spiritCategoryId: 'sc-vodka',    name: 'Absolut',              brand: 'Absolut',          tier: 'call',      bottleSizeMl: 750, unitCost: 15.00 },
  { id: 'bottle-vodka-ketel',      spiritCategoryId: 'sc-vodka',    name: 'Ketel One',             brand: 'Ketel One',        tier: 'premium',   bottleSizeMl: 750, unitCost: 22.00 },
  { id: 'bottle-vodka-belvedere',  spiritCategoryId: 'sc-vodka',    name: 'Belvedere',             brand: 'Belvedere',        tier: 'top_shelf', bottleSizeMl: 750, unitCost: 30.00 },
  // ── Gin ─────────────────────────────────────────────────────────────────────
  { id: 'bottle-gin-tanqueray',    spiritCategoryId: 'sc-gin',      name: 'Tanqueray',             brand: 'Tanqueray',        tier: 'call',      bottleSizeMl: 750, unitCost: 18.00 },
  { id: 'bottle-gin-tanq10',       spiritCategoryId: 'sc-gin',      name: 'Tanqueray No. Ten',     brand: 'Tanqueray',        tier: 'top_shelf', bottleSizeMl: 750, unitCost: 35.00 },
  // ── Rum ─────────────────────────────────────────────────────────────────────
  { id: 'bottle-rum-bacardi-gold', spiritCategoryId: 'sc-rum',      name: 'Bacardi Gold',          brand: 'Bacardi',          tier: 'call',      bottleSizeMl: 750, unitCost: 14.00 },
  { id: 'bottle-rum-mount-gay',    spiritCategoryId: 'sc-rum',      name: 'Mount Gay Eclipse',     brand: 'Mount Gay',        tier: 'premium',   bottleSizeMl: 750, unitCost: 20.00 },
  // ── Tequila ─────────────────────────────────────────────────────────────────
  { id: 'bottle-tequila-espolon',  spiritCategoryId: 'sc-tequila',  name: 'Espolòn Blanco',        brand: 'Espolòn',          tier: 'call',      bottleSizeMl: 750, unitCost: 18.00 },
  { id: 'bottle-tequila-hornitos', spiritCategoryId: 'sc-tequila',  name: 'Hornitos Plata',        brand: 'Hornitos',         tier: 'call',      bottleSizeMl: 750, unitCost: 20.00 },
  { id: 'bottle-tequila-1800',     spiritCategoryId: 'sc-tequila',  name: '1800 Silver',           brand: '1800',             tier: 'premium',   bottleSizeMl: 750, unitCost: 22.00 },
  { id: 'bottle-tequila-casamigos',spiritCategoryId: 'sc-tequila',  name: 'Casamigos Blanco',      brand: 'Casamigos',        tier: 'top_shelf', bottleSizeMl: 750, unitCost: 40.00 },
  // ── Whiskey ─────────────────────────────────────────────────────────────────
  { id: 'bottle-whiskey-jameson',  spiritCategoryId: 'sc-whiskey',  name: 'Jameson Irish Whiskey', brand: 'Jameson',          tier: 'premium',   bottleSizeMl: 750, unitCost: 22.00 },
  { id: 'bottle-whiskey-crown',    spiritCategoryId: 'sc-whiskey',  name: 'Crown Royal',           brand: 'Crown Royal',      tier: 'premium',   bottleSizeMl: 750, unitCost: 22.00 },
  // ── Bourbon ─────────────────────────────────────────────────────────────────
  { id: 'bottle-bourbon-buffalo',  spiritCategoryId: 'sc-bourbon',  name: 'Buffalo Trace',         brand: 'Buffalo Trace',    tier: 'call',      bottleSizeMl: 750, unitCost: 18.00 },
  { id: 'bottle-bourbon-makers',   spiritCategoryId: 'sc-bourbon',  name: "Maker's Mark",          brand: "Maker's Mark",     tier: 'premium',   bottleSizeMl: 750, unitCost: 25.00 },
  { id: 'bottle-bourbon-blantons', spiritCategoryId: 'sc-bourbon',  name: "Blanton's Single Barrel", brand: "Blanton's",      tier: 'top_shelf', bottleSizeMl: 750, unitCost: 55.00 },
]

// ─── Brand catalog per spirit ─────────────────────────────────────────────────
// Replace the generic 4-tier options with real brand choices + specific pricing.
// sortOrder determines display order; upcharge is added to the base cocktail price.
interface BrandEntry { bottleId: string; name: string; upcharge: number; tier: string; so: number; isDefault: boolean }

const BRANDS: Record<string, BrandEntry[]> = {
  vodka: [
    { bottleId: 'bottle-vodka-well',     name: 'House Vodka',       upcharge: 0.00, tier: 'well',      so: 1, isDefault: true  },
    { bottleId: 'bottle-vodka-call',     name: 'Smirnoff',          upcharge: 2.00, tier: 'call',      so: 2, isDefault: false },
    { bottleId: 'bottle-vodka-absolut',  name: 'Absolut',           upcharge: 3.00, tier: 'call',      so: 3, isDefault: false },
    { bottleId: 'bottle-vodka-premium',  name: "Tito's Handmade",   upcharge: 4.00, tier: 'premium',   so: 4, isDefault: false },
    { bottleId: 'bottle-vodka-ketel',    name: 'Ketel One',         upcharge: 5.00, tier: 'premium',   so: 5, isDefault: false },
    { bottleId: 'bottle-vodka-top',      name: 'Grey Goose',        upcharge: 6.00, tier: 'top_shelf', so: 6, isDefault: false },
    { bottleId: 'bottle-vodka-belvedere',name: 'Belvedere',         upcharge: 7.00, tier: 'top_shelf', so: 7, isDefault: false },
  ],
  gin: [
    { bottleId: 'bottle-gin-well',      name: 'House Gin',          upcharge: 0.00, tier: 'well',      so: 1, isDefault: true  },
    { bottleId: 'bottle-gin-call',      name: 'Beefeater',          upcharge: 2.00, tier: 'call',      so: 2, isDefault: false },
    { bottleId: 'bottle-gin-tanqueray', name: 'Tanqueray',          upcharge: 3.00, tier: 'call',      so: 3, isDefault: false },
    { bottleId: 'bottle-gin-premium',   name: 'Bombay Sapphire',    upcharge: 4.00, tier: 'premium',   so: 4, isDefault: false },
    { bottleId: 'bottle-gin-top',       name: "Hendrick's",         upcharge: 5.00, tier: 'premium',   so: 5, isDefault: false },
    { bottleId: 'bottle-gin-tanq10',    name: 'Tanqueray No. Ten',  upcharge: 7.00, tier: 'top_shelf', so: 6, isDefault: false },
  ],
  rum: [
    { bottleId: 'bottle-rum-well',       name: 'House Rum',          upcharge: 0.00, tier: 'well',      so: 1, isDefault: true  },
    { bottleId: 'bottle-rum-call',       name: 'Bacardi Superior',   upcharge: 2.00, tier: 'call',      so: 2, isDefault: false },
    { bottleId: 'bottle-rum-bacardi-gold', name: 'Bacardi Gold',     upcharge: 2.00, tier: 'call',      so: 3, isDefault: false },
    { bottleId: 'bottle-rum-premium',    name: 'Captain Morgan',     upcharge: 3.00, tier: 'premium',   so: 4, isDefault: false },
    { bottleId: 'bottle-rum-mount-gay',  name: 'Mount Gay Eclipse',  upcharge: 4.00, tier: 'premium',   so: 5, isDefault: false },
    { bottleId: 'bottle-rum-top',        name: 'Diplomatico Reserva',upcharge: 6.00, tier: 'top_shelf', so: 6, isDefault: false },
  ],
  tequila: [
    { bottleId: 'bottle-tequila-well',    name: 'House Tequila',      upcharge: 0.00, tier: 'well',      so: 1, isDefault: true  },
    { bottleId: 'bottle-tequila-espolon', name: 'Espolòn Blanco',     upcharge: 2.00, tier: 'call',      so: 2, isDefault: false },
    { bottleId: 'bottle-tequila-hornitos',name: 'Hornitos Plata',     upcharge: 3.00, tier: 'call',      so: 3, isDefault: false },
    { bottleId: 'bottle-tequila-call',    name: 'Jose Cuervo Gold',   upcharge: 3.00, tier: 'call',      so: 4, isDefault: false },
    { bottleId: 'bottle-tequila-1800',    name: '1800 Silver',        upcharge: 4.00, tier: 'premium',   so: 5, isDefault: false },
    { bottleId: 'bottle-tequila-premium', name: 'Patrón Silver',      upcharge: 7.00, tier: 'top_shelf', so: 6, isDefault: false },
    { bottleId: 'bottle-tequila-casamigos', name: 'Casamigos Blanco', upcharge: 7.00, tier: 'top_shelf', so: 7, isDefault: false },
    { bottleId: 'bottle-tequila-top',     name: 'Don Julio Blanco',   upcharge: 8.00, tier: 'top_shelf', so: 8, isDefault: false },
  ],
  whiskey: [
    { bottleId: 'bottle-whiskey-well',    name: 'House Whiskey',      upcharge: 0.00, tier: 'well',      so: 1, isDefault: true  },
    { bottleId: 'bottle-whiskey-call',    name: 'Jim Beam White',     upcharge: 2.00, tier: 'call',      so: 2, isDefault: false },
    { bottleId: 'bottle-whiskey-premium', name: "Jack Daniel's",      upcharge: 3.00, tier: 'premium',   so: 3, isDefault: false },
    { bottleId: 'bottle-whiskey-jameson', name: 'Jameson Irish',      upcharge: 3.00, tier: 'premium',   so: 4, isDefault: false },
    { bottleId: 'bottle-whiskey-crown',   name: 'Crown Royal',        upcharge: 4.00, tier: 'premium',   so: 5, isDefault: false },
    { bottleId: 'bottle-whiskey-top',     name: 'Knob Creek',         upcharge: 5.00, tier: 'top_shelf', so: 6, isDefault: false },
  ],
  bourbon: [
    { bottleId: 'bottle-bourbon-well',    name: 'House Bourbon',      upcharge: 0.00, tier: 'well',      so: 1, isDefault: true  },
    { bottleId: 'bottle-bourbon-call',    name: 'Evan Williams',      upcharge: 1.00, tier: 'call',      so: 2, isDefault: false },
    { bottleId: 'bottle-bourbon-buffalo', name: 'Buffalo Trace',      upcharge: 3.00, tier: 'call',      so: 3, isDefault: false },
    { bottleId: 'bottle-bourbon-premium', name: 'Bulleit Bourbon',    upcharge: 4.00, tier: 'premium',   so: 4, isDefault: false },
    { bottleId: 'bottle-bourbon-makers',  name: "Maker's Mark",       upcharge: 4.00, tier: 'premium',   so: 5, isDefault: false },
    { bottleId: 'bottle-bourbon-top',     name: 'Woodford Reserve',   upcharge: 6.00, tier: 'top_shelf', so: 6, isDefault: false },
    { bottleId: 'bottle-bourbon-blantons',name: "Blanton's",          upcharge: 9.00, tier: 'top_shelf', so: 7, isDefault: false },
  ],
}

// All 35 cocktails that have spirit upgrade groups (matches seed-cocktails.ts)
const COCKTAILS_WITH_SPIRITS: Array<{ id: string; spirit: string }> = [
  { id: 'cocktail-vodka-soda',       spirit: 'vodka'   },
  { id: 'cocktail-cuba-libre',       spirit: 'rum'     },
  { id: 'cocktail-jack-coke',        spirit: 'whiskey' },
  { id: 'cocktail-screwdriver',      spirit: 'vodka'   },
  { id: 'cocktail-vodka-tonic',      spirit: 'vodka'   },
  { id: 'cocktail-gin-tonic',        spirit: 'gin'     },
  { id: 'cocktail-ranch-water',      spirit: 'tequila' },
  { id: 'cocktail-tequila-sunrise',  spirit: 'tequila' },
  { id: 'cocktail-bloody-mary',      spirit: 'vodka'   },
  { id: 'cocktail-daiquiri',         spirit: 'rum'     },
  { id: 'cocktail-dark-stormy',      spirit: 'rum'     },
  { id: 'cocktail-frozen-marg',      spirit: 'tequila' },
  { id: 'cocktail-gimlet',           spirit: 'gin'     },
  { id: 'cocktail-lemon-drop',       spirit: 'vodka'   },
  { id: 'cocktail-margarita',        spirit: 'tequila' },
  { id: 'cocktail-marg-rocks',       spirit: 'tequila' },
  { id: 'cocktail-mexican-mule',     spirit: 'tequila' },
  { id: 'cocktail-mint-julep',       spirit: 'bourbon' },
  { id: 'cocktail-mojito',           spirit: 'rum'     },
  { id: 'cocktail-moscow-mule',      spirit: 'vodka'   },
  { id: 'cocktail-paloma',           spirit: 'tequila' },
  { id: 'cocktail-tom-collins',      spirit: 'gin'     },
  { id: 'cocktail-whiskey-sour',     spirit: 'whiskey' },
  { id: 'cocktail-cosmopolitan',     spirit: 'vodka'   },
  { id: 'cocktail-old-fashioned',    spirit: 'bourbon' },
  { id: 'cocktail-pina-colada',      spirit: 'rum'     },
  { id: 'cocktail-vodka-martini',    spirit: 'vodka'   },
  { id: 'cocktail-aviation',         spirit: 'gin'     },
  { id: 'cocktail-gin-martini',      spirit: 'gin'     },
  { id: 'cocktail-mai-tai',          spirit: 'rum'     },
  { id: 'cocktail-manhattan',        spirit: 'whiskey' },
  { id: 'cocktail-negroni',          spirit: 'gin'     },
  { id: 'cocktail-espresso-martini', spirit: 'vodka'   },
  { id: 'cocktail-french-75',        spirit: 'gin'     },
  { id: 'cocktail-zombie',           spirit: 'rum'     },
]

async function main() {
  console.log('\n🥃 GWI Brand Upgrades Seed\n')

  // ── 1. Add new brand bottles ─────────────────────────────────────────────────
  console.log('  [1/2] Adding new brand bottles...')
  let newBottleCount = 0
  for (const b of NEW_BOTTLES) {
    await prisma.bottleProduct.upsert({
      where:  { id: b.id },
      update: {},
      create: {
        id:              b.id,
        locationId:      LOC,
        spiritCategoryId:b.spiritCategoryId,
        name:            b.name,
        brand:           b.brand,
        tier:            b.tier,
        bottleSizeMl:    b.bottleSizeMl,
        unitCost:        b.unitCost,
        isActive:        true,
      },
    })
    newBottleCount++
  }
  console.log(`  ✓ ${newBottleCount} new brand bottles added/verified`)

  // ── 2. Replace upgrade modifiers with brand-specific options ─────────────────
  console.log('\n  [2/2] Rebuilding cocktail upgrade modifiers with real brands...')

  let groupCount = 0
  let modCount   = 0

  for (const c of COCKTAILS_WITH_SPIRITS) {
    const mgId   = `cmg-${c.id.replace('cocktail-', '')}`
    const brands = BRANDS[c.spirit]
    if (!brands) continue

    // Verify the modifier group exists before touching it
    const group = await prisma.modifierGroup.findUnique({ where: { id: mgId } })
    if (!group) {
      console.warn(`  ⚠️  Modifier group ${mgId} not found — run seed-cocktails.ts first`)
      continue
    }

    // Delete existing modifiers for this group (generic 4-tier ones)
    await prisma.modifier.deleteMany({ where: { modifierGroupId: mgId } })

    // Create brand-specific modifiers
    for (const brand of brands) {
      // Sanitize bottle ID into a short suffix: bottle-vodka-absolut → vodka-absolut
      const suffix = brand.bottleId.replace('bottle-', '').replace(/[^a-z0-9-]/g, '')
      const modId  = `cm-${c.id.replace('cocktail-', '')}-${suffix}`

      await prisma.modifier.create({
        data: {
          id:                    modId,
          locationId:            LOC,
          modifierGroupId:       mgId,
          name:                  brand.name,
          price:                 brand.upcharge,
          priceType:             'upcharge',
          spiritTier:            brand.tier,
          linkedBottleProductId: brand.bottleId,
          isDefault:             brand.isDefault,
          isActive:              true,
          showOnPOS:             true,
          sortOrder:             brand.so,
          printerRouting:        'follow',
        },
      })
      modCount++
    }
    groupCount++
  }

  console.log(`  ✓ ${groupCount} upgrade groups rebuilt`)
  console.log(`  ✓ ${modCount} brand modifiers created`)

  // ── Summary ───────────────────────────────────────────────────────────────────
  const bottleTotal = await prisma.bottleProduct.count({ where: { locationId: LOC } })

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Brand upgrades complete!

  New brand bottles added:   ${newBottleCount}
  Total bottles in catalog:  ${bottleTotal}
  Cocktail upgrade groups:   ${groupCount}
  Brand modifiers created:   ${modCount}

Brand options per spirit on every cocktail:

  🥛 Vodka (7 brands)
     House → Smirnoff +$2 → Absolut +$3 → Tito's +$4 → Ketel One +$5 → Grey Goose +$6 → Belvedere +$7

  🌿 Gin (6 brands)
     House → Beefeater +$2 → Tanqueray +$3 → Bombay Sapphire +$4 → Hendrick's +$5 → Tanqueray No. Ten +$7

  🥤 Rum (6 brands)
     House → Bacardi Superior +$2 → Bacardi Gold +$2 → Captain Morgan +$3 → Mount Gay +$4 → Diplomatico +$6

  🌵 Tequila (8 brands)
     House → Espolòn +$2 → Hornitos +$3 → Jose Cuervo +$3 → 1800 Silver +$4 → Patrón +$7 → Casamigos +$7 → Don Julio +$8

  🥃 Whiskey (6 brands)
     House → Jim Beam +$2 → Jack Daniel's +$3 → Jameson +$3 → Crown Royal +$4 → Knob Creek +$5

  🍯 Bourbon (7 brands)
     House → Evan Williams +$1 → Buffalo Trace +$3 → Bulleit +$4 → Maker's Mark +$4 → Woodford Reserve +$6 → Blanton's +$9

Next steps:
  1. /liquor-builder → Drinks tab — tap any cocktail to see brand upgrade buttons
  2. Adjust prices to match your market under each cocktail
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

main()
  .catch((e) => {
    console.error('\n❌ Error during brand upgrades seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
